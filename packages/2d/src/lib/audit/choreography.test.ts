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

  it('rejects an operation referencing an unknown entity', () => {
    const plan: ChoreographyPlan = {
      entities: [
        {id: 'a', role: 'subject', lineage: 'root', recognizableBy: ['shape']},
      ],
      transitions: [
        {
          id: 't1',
          sourceIds: ['a'],
          targetIds: ['missing-entity'],
          operation: 'translate',
          preserves: [],
          changes: ['position'],
          purpose: 'move nonexistent target',
          holdAfter: 'hold',
        },
      ],
    };
    expect(() => validateChoreographyPlan(plan)).toThrow(
      /references unknown entity missing-entity/,
    );
  });

  it('rejects an operation referencing an entity already consumed by a prior replace', () => {
    const plan: ChoreographyPlan = {
      entities: [
        {
          id: 'e1',
          role: 'subject',
          lineage: 'root',
          recognizableBy: ['circle'],
        },
        {
          id: 'e2',
          role: 'subject',
          lineage: 'replacement',
          parentIds: ['e1'],
          recognizableBy: ['square'],
        },
      ],
      transitions: [
        {
          id: 't1',
          sourceIds: ['e1'],
          targetIds: ['e2'],
          operation: 'replace',
          preserves: ['position'],
          changes: ['shape'],
          purpose: 'replace circle with square',
          holdAfter: 'hold_replace',
        },
        {
          id: 't2',
          sourceIds: ['e1'],
          targetIds: ['e1'],
          operation: 'scale',
          preserves: [],
          changes: ['scale'],
          purpose: 'scale already-replaced entity',
          holdAfter: 'hold_scale',
        },
      ],
    };
    expect(() => validateChoreographyPlan(plan)).toThrow(
      /references entity e1 already consumed by prior transition/,
    );
  });

  it('rejects an operation referencing an entity already consumed by a prior summarize', () => {
    const plan: ChoreographyPlan = {
      entities: [
        {
          id: 'datum1',
          role: 'evidence',
          lineage: 'root',
          recognizableBy: ['bar1'],
        },
        {
          id: 'datum2',
          role: 'evidence',
          lineage: 'root',
          recognizableBy: ['bar2'],
        },
        {
          id: 'summary',
          role: 'conclusion',
          lineage: 'summary',
          parentIds: ['datum1', 'datum2'],
          recognizableBy: ['trend line'],
        },
      ],
      transitions: [
        {
          id: 't1',
          sourceIds: ['datum1', 'datum2'],
          targetIds: ['summary'],
          operation: 'summarize',
          preserves: [],
          changes: ['representation'],
          purpose: 'summarize data into trend',
          holdAfter: 'hold_summary',
        },
        {
          id: 't2',
          sourceIds: ['datum1'],
          targetIds: ['datum1'],
          operation: 'translate',
          preserves: [],
          changes: ['position'],
          purpose: 'move datum1 after it was summarized',
          holdAfter: 'hold_datum1',
        },
      ],
    };
    expect(() => validateChoreographyPlan(plan)).toThrow(
      /references entity datum1 already consumed by prior transition/,
    );
  });

  it('rejects an entity that is its own parent', () => {
    const plan: ChoreographyPlan = {
      entities: [
        {
          id: 'loop',
          role: 'subject',
          lineage: 'clone',
          parentIds: ['loop'],
          recognizableBy: ['self'],
        },
      ],
      transitions: [],
    };
    expect(() => validateChoreographyPlan(plan)).toThrow(
      /cannot be its own parent/,
    );
  });

  it('rejects a root entity declaring parents', () => {
    const plan: ChoreographyPlan = {
      entities: [
        {
          id: 'parent',
          role: 'subject',
          lineage: 'root',
          recognizableBy: ['orig'],
        },
        {
          id: 'root-with-parents',
          role: 'subject',
          lineage: 'root',
          parentIds: ['parent'],
          recognizableBy: ['fake-root'],
        },
      ],
      transitions: [],
    };
    expect(() => validateChoreographyPlan(plan)).toThrow(
      /cannot declare parents/,
    );
  });

  it('accepts a deliberately complex valid plan with 10+ sequenced operations', () => {
    // A sequence with 12 entities and 10 transitions:
    // roots: nodeA, nodeB, axis
    // operations:
    // 1. translate nodeA
    // 2. scale nodeB
    // 3. duplicate nodeA -> cloneA1
    // 4. split nodeB -> splitB1, splitB2
    // 5. rearrange cloneA1
    // 6. focus splitB1
    // 7. recede splitB2
    // 8. merge [splitB1, splitB2] -> mergedB
    // 9. replace nodeA -> replA (consuming nodeA)
    // 10. summarize [mergedB, replA] -> conclusion (consuming mergedB and replA)
    const plan: ChoreographyPlan = {
      entities: [
        {
          id: 'nodeA',
          role: 'subject',
          lineage: 'root',
          recognizableBy: ['blue circle'],
        },
        {
          id: 'nodeB',
          role: 'evidence',
          lineage: 'root',
          recognizableBy: ['green square'],
        },
        {
          id: 'axis',
          role: 'context',
          lineage: 'root',
          recognizableBy: ['hairline grid'],
        },
        {
          id: 'cloneA1',
          role: 'subject',
          lineage: 'clone',
          parentIds: ['nodeA'],
          recognizableBy: ['ghost circle'],
        },
        {
          id: 'splitB1',
          role: 'evidence',
          lineage: 'split',
          parentIds: ['nodeB'],
          recognizableBy: ['left fragment'],
        },
        {
          id: 'splitB2',
          role: 'evidence',
          lineage: 'split',
          parentIds: ['nodeB'],
          recognizableBy: ['right fragment'],
        },
        {
          id: 'mergedB',
          role: 'evidence',
          lineage: 'merge',
          parentIds: ['splitB1', 'splitB2'],
          recognizableBy: ['recombined square'],
        },
        {
          id: 'replA',
          role: 'subject',
          lineage: 'replacement',
          parentIds: ['nodeA'],
          recognizableBy: ['coral circle'],
        },
        {
          id: 'conclusion',
          role: 'conclusion',
          lineage: 'summary',
          parentIds: ['mergedB', 'replA'],
          recognizableBy: ['final synthesis formula'],
        },
      ],
      transitions: [
        {
          id: 't1_translate',
          sourceIds: ['nodeA'],
          targetIds: ['nodeA'],
          operation: 'translate',
          preserves: ['identity', 'scale'],
          changes: ['position'],
          purpose: 'translate primary subject nodeA across axis',
          holdAfter: 'hold_t1',
        },
        {
          id: 't2_scale',
          sourceIds: ['nodeB'],
          targetIds: ['nodeB'],
          operation: 'scale',
          preserves: ['identity', 'position'],
          changes: ['scale'],
          purpose: 'scale evidence nodeB',
          holdAfter: 'hold_t2',
        },
        {
          id: 't3_duplicate',
          sourceIds: ['nodeA'],
          targetIds: ['cloneA1'],
          operation: 'duplicate',
          preserves: ['position'],
          changes: ['opacity', 'clone-state'],
          purpose: 'clone nodeA into cloneA1',
          holdAfter: 'hold_t3',
        },
        {
          id: 't4_split',
          sourceIds: ['nodeB'],
          targetIds: ['splitB1', 'splitB2'],
          operation: 'split',
          preserves: ['volume'],
          changes: ['position', 'fragment-identity'],
          purpose: 'split nodeB into two parts',
          holdAfter: 'hold_t4',
        },
        {
          id: 't5_rearrange',
          sourceIds: ['cloneA1'],
          targetIds: ['cloneA1'],
          operation: 'rearrange',
          preserves: ['identity'],
          changes: ['layout-order'],
          purpose: 'rearrange cloneA1 relative to axis',
          holdAfter: 'hold_t5',
        },
        {
          id: 't6_focus',
          sourceIds: ['splitB1'],
          targetIds: ['splitB1'],
          operation: 'focus',
          preserves: ['identity', 'position'],
          changes: ['focus-highlight'],
          purpose: 'focus left fragment',
          holdAfter: 'hold_t6',
        },
        {
          id: 't7_recede',
          sourceIds: ['splitB2'],
          targetIds: ['splitB2'],
          operation: 'recede',
          preserves: ['identity', 'position'],
          changes: ['opacity-dim'],
          purpose: 'dim right fragment',
          holdAfter: 'hold_t7',
        },
        {
          id: 't8_merge',
          sourceIds: ['splitB1', 'splitB2'],
          targetIds: ['mergedB'],
          operation: 'merge',
          preserves: ['combined-volume'],
          changes: ['unified-shape'],
          purpose: 'recombine fragments into mergedB',
          holdAfter: 'hold_t8',
        },
        {
          id: 't9_replace',
          sourceIds: ['nodeA'],
          targetIds: ['replA'],
          operation: 'replace',
          preserves: ['position'],
          changes: ['color', 'identity'],
          purpose: 'replace nodeA with replA',
          holdAfter: 'hold_t9',
        },
        {
          id: 't10_summarize',
          sourceIds: ['mergedB', 'replA'],
          targetIds: ['conclusion'],
          operation: 'summarize',
          preserves: ['domain-truth'],
          changes: ['aggregate-representation'],
          purpose: 'summarize evidence and replaced subject into conclusion',
          holdAfter: 'hold_final',
        },
      ],
    };

    expect(() => validateChoreographyPlan(plan)).not.toThrow();
  });

  it('Phase 1 DoD: validates complex beat with 15+ entities and sequenced operations cleanly', () => {
    // 16 distinct entities
    const entities: ChoreographyPlan['entities'] = [];
    for (let i = 0; i < 15; i++) {
      entities.push({
        id: `node_${i}`,
        role: i < 5 ? 'subject' : i < 10 ? 'evidence' : 'context',
        lineage: 'root',
        recognizableBy: [`entity-${i}`],
      });
    }
    // Plus a 16th entity generated via derivation/summary
    entities.push({
      id: 'derived_summary',
      role: 'conclusion',
      lineage: 'summary',
      parentIds: ['node_0', 'node_1', 'node_2'],
      recognizableBy: ['combined-proof'],
    });

    const transitions: ChoreographyPlan['transitions'] = [
      {
        id: 't_translate_0',
        sourceIds: ['node_0'],
        targetIds: ['node_0'],
        operation: 'translate',
        preserves: ['scale'],
        changes: ['position'],
        purpose: 'align node 0',
        holdAfter: 'hold_0',
      },
      {
        id: 't_scale_1',
        sourceIds: ['node_1'],
        targetIds: ['node_1'],
        operation: 'scale',
        preserves: ['position'],
        changes: ['scale'],
        purpose: 'emphasize node 1',
        holdAfter: 'hold_1',
      },
      {
        id: 't_rearrange_context',
        sourceIds: ['node_10', 'node_11', 'node_12'],
        targetIds: ['node_10', 'node_11', 'node_12'],
        operation: 'rearrange',
        preserves: ['identity'],
        changes: ['layout-order'],
        purpose: 'reorder context layer',
        holdAfter: 'hold_reorder',
      },
      {
        id: 't_summarize',
        sourceIds: ['node_0', 'node_1', 'node_2'],
        targetIds: ['derived_summary'],
        operation: 'summarize',
        preserves: ['mathematical-truth'],
        changes: ['representation'],
        purpose: 'synthesize nodes 0, 1, 2 into derived summary',
        holdAfter: 'hold_final',
      },
    ];

    const plan: ChoreographyPlan = {entities, transitions};
    expect(() => validateChoreographyPlan(plan)).not.toThrow();
    expect(plan.entities.length).toBeGreaterThanOrEqual(15);
  });
});
