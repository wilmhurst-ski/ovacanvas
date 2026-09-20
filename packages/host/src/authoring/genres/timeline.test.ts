import {describe, expect, it} from 'vitest';
import {TimelineGenre} from './timeline';

describe('TimelineGenre', () => {
  const genre = new TimelineGenre();

  it('matches structure with an events array of at least 2 events', () => {
    expect(
      genre.matchesStructure({
        title: 'Stages',
        events: [
          {label: 'A', position: 1},
          {label: 'B', position: 2},
        ],
      }),
    ).toBe(true);

    expect(
      genre.matchesStructure({
        title: 'Single',
        events: [{label: 'A', position: 1}],
      }),
    ).toBe(false);

    expect(genre.matchesStructure({})).toBe(false);
  });

  it('validates and compiles a historical timeline with chronological ordering', () => {
    const intent = {
      title: 'Major Milestones of Space Exploration',
      events: [
        {label: 'Apollo 11', position: 1969, note: 'Moon landing'},
        {
          label: 'Sputnik 1',
          position: 1957,
          note: 'First artificial satellite',
        },
        {label: 'ISS', position: 1998, note: 'First module launched'},
        {label: 'Voyager 1', position: 1977, note: 'Interstellar mission'},
      ],
    };

    const validation = genre.validateIntent(intent);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;

    // Should be automatically sorted by position ascending
    expect(validation.intent.events[0].position).toBe(1957);
    expect(validation.intent.events[1].position).toBe(1969);
    expect(validation.intent.events[2].position).toBe(1977);
    expect(validation.intent.events[3].position).toBe(1998);

    const source = genre.compileIntentToSource(validation.intent);
    expect(source).toContain('Major Milestones of Space Exploration');
    expect(source).toContain('AnchoredLabel');
    expect(source).toContain('Circle');
    expect(source).toContain('Line');
    expect(source).toContain('buildAuditSpec');
    expect(source).toContain('choreographyPlan');
    expect(source).toContain('Sputnik 1');
    expect(source).toContain('Apollo 11');
  });

  it('validates and compiles a non-historical sequential process', () => {
    const intent = {
      title: 'Compiler Pipeline Stages',
      events: [
        {label: 'Lexing', position: 1},
        {label: 'Parsing', position: 2},
        {label: 'Type Checking', position: 3},
        {label: 'Optimization', position: 4},
        {label: 'Code Generation', position: 5},
      ],
    };

    const validation = genre.validateIntent(intent);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;

    const source = genre.compileIntentToSource(validation.intent);
    expect(source).toContain('Compiler Pipeline Stages');
    expect(source).toContain('marker_0');
    expect(source).toContain('marker_4');
    expect(source).toContain('label_4');
  });

  it('rejects timelines with too many events exceeding display bounds', () => {
    const crowded = {
      title: 'Too Crowded',
      events: [
        {label: 'E1', position: 1},
        {label: 'E2', position: 2},
        {label: 'E3', position: 3},
        {label: 'E4', position: 4},
        {label: 'E5', position: 5},
        {label: 'E6', position: 6},
        {label: 'E7', position: 7},
      ],
    };
    const validation = genre.validateIntent(crowded);
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      expect(validation.errors[0]).toContain('Too many events');
    }
  });
});
