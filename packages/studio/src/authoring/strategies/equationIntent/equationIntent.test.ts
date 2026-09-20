import {compileBeatModule} from '@ovacanvas/host/authoring';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {compileEquationSolveSource, computeStepTimings} from './compiler';
import {MAX_STEPS, validateEquationSolveIntent} from './intent';
import {equationIntent} from './strategy';

// packages/host: it has @ovacanvas/2d and @ovacanvas/core as real
// dependencies, so a generated module's imports resolve exactly as they would
// in a consuming project.
const COMPILE_ROOT = fileURLToPath(
  new URL('../../../../../host', import.meta.url),
);

const LINEAR = {
  title: 'Solving a Linear Equation',
  steps: [
    {tex: '{{2x}} + 3 = 7'},
    {tex: '{{2x}} = 4', note: 'Subtract 3 from both sides'},
    {tex: 'x = 2', note: 'Divide both sides by 2'},
  ],
};

describe('validateEquationSolveIntent', () => {
  it('accepts a well-formed intent and drops nothing', () => {
    const result = validateEquationSolveIntent(LINEAR);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intent.steps).toHaveLength(3);
      expect(result.intent.steps[1].note).toBe('Subtract 3 from both sides');
      expect(result.intent.steps[0].note).toBeUndefined();
    }
  });

  it('names the offending field rather than failing generically', () => {
    const cases: Array<[unknown, RegExp]> = [
      ['just prose', /must be a JSON object/],
      [{steps: [{tex: 'x'}]}, /"title"/],
      [{title: 'T'}, /"steps"/],
      [{title: 'T', steps: []}, /"steps"/],
      [{title: 'T', steps: [{}]}, /steps\[0\]\.tex/],
      [{title: 'T', steps: [{tex: 'x', note: '  '}]}, /steps\[0\]\.note/],
    ];
    for (const [input, expected] of cases) {
      const result = validateEquationSolveIntent(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(expected);
    }
  });

  it('refuses more steps than one beat can hold, and says why', () => {
    const steps = Array.from({length: MAX_STEPS + 1}, (_, i) => ({
      tex: `s${i}`,
    }));
    const result = validateEquationSolveIntent({title: 'T', steps});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/capped at 6 seconds/);
  });
});

describe('computeStepTimings', () => {
  it('keeps the whole beat inside the engine cap for every allowed step count', () => {
    // The engine's real limit is 6s, enforced as a blocking audit finding.
    const FIXED_OVERHEAD = 0.4; // the final hold; there is no exit fade
    for (let steps = 2; steps <= MAX_STEPS; steps++) {
      const timings = computeStepTimings(steps - 1);
      const total =
        FIXED_OVERHEAD +
        timings.reduce(
          (sum, timing) =>
            sum + timing.waitBeforeMorph + timing.morphSeconds + 0.3,
          0,
        );
      expect(total).toBeLessThan(6);
    }
  });

  it('divides a fixed budget rather than using fixed per-step durations', () => {
    const two = computeStepTimings(1)[0];
    const five = computeStepTimings(4)[0];
    expect(five.morphSeconds).toBeLessThan(two.morphSeconds);
  });
});

describe('compileEquationSolveSource', () => {
  it('produces a module that the real compiler accepts', () => {
    const source = compileEquationSolveSource(LINEAR);
    const compiled = compileBeatModule(source, COMPILE_ROOT, '__equation__.ts');

    // If this fails, print what the compiler actually objected to - a bare
    // `expect(ok).toBe(true)` here would be the least useful failure in the
    // suite, since the whole point of this strategy is that its template is
    // known-good.
    if (!compiled.ok) {
      throw new Error(
        `generated template did not compile:\n${compiled.diagnostics
          .map(d => `  ${d.message} (line ${d.line})`)
          .join('\n')}`,
      );
    }
    expect(compiled.code).toContain('buildAuditSpec');
  });

  it('is deterministic - the same intent always yields the same module', () => {
    expect(compileEquationSolveSource(LINEAR)).toBe(
      compileEquationSolveSource(LINEAR),
    );
  });

  it("emits the model's mathematics verbatim and nothing of its own", () => {
    const source = compileEquationSolveSource(LINEAR);
    expect(source).toContain('"{{2x}} + 3 = 7"');
    expect(source).toContain('"Subtract 3 from both sides"');
    expect(source).toContain('"Solving a Linear Equation"');
  });

  it('shows its required content at frame 0 rather than fading it in from nothing', () => {
    // A beat is inert once shown, so frame 0 is what the learner sees. An
    // opacity-0 entrance therefore renders a blank canvas - which this
    // template did until it was rendered and looked at.
    const withNote = compileEquationSolveSource({
      title: 'Solving a Linear Equation',
      steps: [
        {tex: '{{2x}} + 3 = 7', note: 'Start from the given equation'},
        {tex: '{{2x}} = 4', note: 'Subtract 3 from both sides'},
      ],
    });
    // Nothing at all is hidden when the first step has something to say.
    expect(withNote).not.toMatch(/opacity: 0/);
    expect(withNote).toContain("requiredIds: ['title', 'equation', 'note']");
  });

  it('hides an empty note rather than shipping a zero-height label', () => {
    // The first step of a derivation usually has no note, so the label has no
    // text and therefore an empty bound - which the audit refuses. It must
    // start hidden AND stay out of requiredIds, or the visibility gate then
    // refuses it for the opposite reason. `LINEAR`'s first step has no note.
    const source = compileEquationSolveSource(LINEAR);
    const noteBlock = source.slice(source.indexOf('note = new AnchoredLabel'));
    expect(noteBlock).toContain('opacity: 0');
    expect(source).toContain("requiredIds: ['title', 'equation']");
    // The content that IS required must never be hidden.
    const titleBlock = source.slice(
      source.indexOf('title = new Txt'),
      source.indexOf('equation = new Latex'),
    );
    expect(titleBlock).not.toMatch(/opacity: 0/);
  });

  it('does not fade itself out, because a beat loops', () => {
    // One cycle's last frame is immediately followed by the next cycle's
    // first, so an exit fade would blank the board once per pass.
    // Uses an intent whose first step has a note, so the note is visible from
    // the start and there is genuinely nothing hidden anywhere in the scene.
    const source = compileEquationSolveSource({
      title: 'Solving a Linear Equation',
      steps: [
        {tex: '{{2x}} + 3 = 7', note: 'Start from the given equation'},
        {tex: '{{2x}} = 4', note: 'Subtract 3 from both sides'},
      ],
    });
    // The title and the equation must never be faded out - they are what the
    // beat is left holding. The note legitimately fades between steps, which
    // is a different thing and is why this is not a blanket check.
    expect(source).not.toMatch(/title\.opacity\(0/);
    expect(source).not.toMatch(/equation\.opacity\(0/);
    expect(source).not.toContain('opacity: 0');
  });

  it('authorizes the note/equation contact with a stated reason, not a blanket allow-list', () => {
    const source = compileEquationSolveSource(LINEAR);
    expect(source).toContain("mayTouch: new Map([['note', '");
    // A wildcard would wave away any overlap rather than the one real
    // relationship this template creates.
    expect(source).not.toContain("'*'");
  });

  it('compiles every allowed step count, including the smallest', () => {
    for (let steps = 2; steps <= MAX_STEPS; steps++) {
      const intent = {
        title: 'Stepping',
        steps: Array.from({length: steps}, (_, i) => ({
          tex: `{{x}} = ${steps - i}`,
          ...(i > 0 ? {note: `step ${i}`} : {}),
        })),
      };
      const compiled = compileBeatModule(
        compileEquationSolveSource(intent),
        COMPILE_ROOT,
        '__equation__.ts',
      );
      expect(compiled.ok).toBe(true);
    }
  });
});

describe('equationIntent strategy', () => {
  const context = {topic: 'solve 2x + 3 = 7', apiSection: ''};

  it('parses an intent out of a fenced code block', () => {
    const raw = `Here you go:\n\`\`\`json\n${JSON.stringify(LINEAR)}\n\`\`\``;
    const result = equationIntent.interpret(raw, context);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.extraction.intent).toEqual(LINEAR);
  });

  it('explains a prose reply instead of guessing at one', () => {
    const result = equationIntent.interpret(
      'Subtract three from both sides.',
      context,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/contained no JSON object/);
  });

  it('explains malformed JSON differently from a structurally wrong object', () => {
    const malformed = equationIntent.interpret(
      '{"title": "T", "steps": [',
      context,
    );
    const wrongShape = equationIntent.interpret(
      '{"title": "T", "steps": []}',
      context,
    );
    expect(malformed.ok).toBe(false);
    expect(wrongShape.ok).toBe(false);
    if (!malformed.ok && !wrongShape.ok) {
      expect(malformed.error).toMatch(/not valid JSON/);
      expect(wrongShape.error).toMatch(/"steps"/);
      expect(malformed.error).not.toBe(wrongShape.error);
    }
  });

  it('routes unmistakable solve-for-x topics to itself', () => {
    for (const topic of [
      'solve 2x + 3 = 7',
      'Solve for x: 5(x - 2) = 3x + 4',
      'step by step solve this quadratic equation',
      'factor the quadratic x^2 - 5x + 6',
      'find the roots of x^2 - 4 = 0',
      'isolate the variable in y = mx + b',
    ]) {
      expect(equationIntent.matches(topic), topic).toBe(true);
    }
  });

  it('declines topics that merely mention maths, so they fall through to the general path', () => {
    for (const topic of [
      'what is a derivative',
      'explain the Pythagorean theorem',
      'what causes the seasons',
      'how does a binary search work',
      'show the parts of a plant cell',
      'history of the Roman empire',
    ]) {
      expect(equationIntent.matches(topic), topic).toBe(false);
    }
  });

  it('never asks the model for code - the whole point of this strategy', () => {
    const prompt = equationIntent.buildSystemPrompt(context);
    expect(prompt).toMatch(/Output ONLY a JSON object/);
    expect(prompt).not.toMatch(/makeScene2D/);
    expect(prompt).not.toMatch(/buildAuditSpec/);
    expect(prompt).not.toMatch(/import /);
  });
});
