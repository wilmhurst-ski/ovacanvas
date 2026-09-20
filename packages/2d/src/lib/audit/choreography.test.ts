import {describe, expect, it} from 'vitest';
import {validateChoreographyPlan, type ChoreographyPlan} from './choreography';

function basePlan(): ChoreographyPlan {
  return {
    entities: [
      {
        id: 'root',
        role: 'subject',
        lineage: 'root',
        recognizableBy: ['blue curve'],
      },
    ],
    transitions: [],
  };
}

describe('validateChoreographyPlan', () => {
  it('accepts a minimal valid plan', () => {
    expect(() => validateChoreographyPlan(basePlan())).not.toThrow();
  });

  it('rejects a lineage cycle', () => {
    const plan: ChoreographyPlan = {
      entities: [
        {
          id: 'a',
          role: 'subject',
          lineage: 'clone',
          parentIds: ['b'],
          recognizableBy: ['x'],
        },
        {
          id: 'b',
          role: 'subject',
          lineage: 'clone',
          parentIds: ['a'],
          recognizableBy: ['y'],
        },
      ],
      transitions: [],
    };
    expect(() => validateChoreographyPlan(plan)).toThrow(/cycle/);
  });

  it('rejects a split transition with only one target', () => {
    const plan: ChoreographyPlan = {
      entities: [
        {id: 'a', role: 'subject', lineage: 'root', recognizableBy: ['x']},
        {
          id: 'b',
          role: 'evidence',
          lineage: 'split',
          parentIds: ['a'],
          recognizableBy: ['y'],
        },
      ],
      transitions: [
        {
          id: 't1',
          sourceIds: ['a'],
          targetIds: ['b'],
          operation: 'split',
          preserves: [],
          changes: ['position'],
          purpose: 'demonstrate a split',
          holdAfter: 'hold_split',
        },
      ],
    };
    expect(() => validateChoreographyPlan(plan)).toThrow(
      /requires one source and multiple targets/,
    );
  });

  it('rejects preserving and changing the same property', () => {
    const plan: ChoreographyPlan = {
      entities: [
        {id: 'a', role: 'subject', lineage: 'root', recognizableBy: ['x']},
      ],
      transitions: [
        {
          id: 't1',
          sourceIds: ['a'],
          targetIds: ['a'],
          operation: 'translate',
          preserves: ['position'],
          changes: ['position'],
          purpose: 'move it',
          holdAfter: 'hold_moved',
        },
      ],
    };
    expect(() => validateChoreographyPlan(plan)).toThrow(
      /both preserves and changes/,
    );
  });
});
