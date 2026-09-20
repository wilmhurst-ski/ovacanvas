/**
 * Pure semantic-plan validation, with no engine dependency: entity lineage,
 * transformation contracts, and the structural rules each operation kind
 * implies. Ported from the skill package unchanged so agent-authored plans
 * and engine code check against one shipped source of truth.
 *
 * @remarks
 * **Nothing calls this, and that is a decision rather than an oversight.** The
 * plan document flagged it as a candidate for a pre-audit semantic sanity
 * check in the authoring pipeline; having built that pipeline, wiring it in
 * would mean the authoring contract also carried a `ChoreographyPlan` for the
 * model to fill in, and nothing produces one today. Adding that contract on
 * the strength of a suggestion - rather than evidence that generated beats
 * fail in ways a plan-level check would catch - is exactly the speculative
 * abstraction this project's conventions warn against.
 *
 * So it stays real, tested and unconsumed, which is a state that needs saying
 * out loud: read cold, a tested module with no callers looks like the API you
 * are supposed to be using. The condition that would change the decision is
 * concrete - beats arriving with semantically wrong transformations (the right
 * shapes, the wrong relationships) rather than geometry the audit can already
 * judge.
 */

export type SemanticRole =
  | 'subject'
  | 'evidence'
  | 'context'
  | 'focus'
  | 'conclusion';

export type LineageKind =
  | 'root'
  | 'clone'
  | 'split'
  | 'merge'
  | 'aggregate'
  | 'replacement'
  | 'summary';

export type OperationKind =
  | 'reveal'
  | 'conceal'
  | 'translate'
  | 'rotate'
  | 'scale'
  | 'deform'
  | 'duplicate'
  | 'split'
  | 'merge'
  | 'aggregate'
  | 'rearrange'
  | 'replace'
  | 'focus'
  | 'recede'
  | 'compare'
  | 'summarize';

export type SemanticEntity = {
  id: string;
  role: SemanticRole;
  lineage: LineageKind;
  parentIds?: readonly string[];
  recognizableBy: readonly string[];
};

export type TransformationContract = {
  id: string;
  sourceIds: readonly string[];
  targetIds: readonly string[];
  operation: OperationKind;
  preserves: readonly string[];
  changes: readonly string[];
  purpose: string;
  holdAfter: string;
};

export type ChoreographyPlan = {
  entities: readonly SemanticEntity[];
  transitions: readonly TransformationContract[];
};

function requireText(value: string, message: string): void {
  if (!value.trim()) throw new Error(message);
}

function requireUnique(values: readonly string[], message: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    requireText(value, message);
    if (seen.has(value)) throw new Error(`${message}: ${value}`);
    seen.add(value);
  }
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every(value => b.includes(value));
}

export function validateChoreographyPlan(plan: ChoreographyPlan): void {
  requireUnique(
    plan.entities.map(entity => entity.id),
    'Duplicate or empty entity ID',
  );
  requireUnique(
    plan.transitions.map(transition => transition.id),
    'Duplicate or empty transition ID',
  );

  const entities = new Map(plan.entities.map(entity => [entity.id, entity]));

  for (const entity of plan.entities) {
    if (entity.recognizableBy.length === 0) {
      throw new Error(`Entity ${entity.id} has no recognizability property`);
    }
    for (const parentId of entity.parentIds ?? []) {
      if (!entities.has(parentId)) {
        throw new Error(`Entity ${entity.id} has unknown parent ${parentId}`);
      }
      if (parentId === entity.id) {
        throw new Error(`Entity ${entity.id} cannot be its own parent`);
      }
    }
    if (entity.lineage === 'root' && (entity.parentIds?.length ?? 0) > 0) {
      throw new Error(`Root entity ${entity.id} cannot declare parents`);
    }
    if (entity.lineage !== 'root' && (entity.parentIds?.length ?? 0) === 0) {
      throw new Error(`Derived entity ${entity.id} must declare parentIds`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      throw new Error(`Entity lineage contains a cycle at ${id}`);
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parentId of entities.get(id)?.parentIds ?? []) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of entities.keys()) visit(id);

  const consumedEntities = new Set<string>();

  for (const transition of plan.transitions) {
    requireText(
      transition.purpose,
      `Transition ${transition.id} has no purpose`,
    );
    requireText(
      transition.holdAfter,
      `Transition ${transition.id} has no resulting hold`,
    );
    requireUnique(
      transition.sourceIds,
      `Transition ${transition.id} repeats a source ID`,
    );
    requireUnique(
      transition.targetIds,
      `Transition ${transition.id} repeats a target ID`,
    );
    requireUnique(
      transition.preserves,
      `Transition ${transition.id} repeats an invariant`,
    );
    requireUnique(
      transition.changes,
      `Transition ${transition.id} repeats a changed property`,
    );

    if (transition.sourceIds.length + transition.targetIds.length === 0) {
      throw new Error(
        `Transition ${transition.id} has no participating entities`,
      );
    }
    if (transition.changes.length === 0) {
      throw new Error(
        `Transition ${transition.id} declares no changed property`,
      );
    }

    for (const id of [...transition.sourceIds, ...transition.targetIds]) {
      if (!entities.has(id)) {
        throw new Error(
          `Transition ${transition.id} references unknown entity ${id}`,
        );
      }
      if (consumedEntities.has(id)) {
        throw new Error(
          `Transition ${transition.id} references entity ${id} already consumed by prior transition`,
        );
      }
    }

    const contradictions = transition.preserves.filter(property =>
      transition.changes.includes(property),
    );
    if (contradictions.length > 0) {
      throw new Error(
        `Transition ${transition.id} both preserves and changes: ${contradictions.join(', ')}`,
      );
    }

    if (transition.operation === 'duplicate') {
      if (transition.sourceIds.length < 1 || transition.targetIds.length < 1) {
        throw new Error(
          `Duplicate transition ${transition.id} needs sources and targets`,
        );
      }
      for (const targetId of transition.targetIds) {
        const target = entities.get(targetId)!;
        if (target.lineage !== 'clone') {
          throw new Error(
            `Duplicate target ${targetId} must use clone lineage`,
          );
        }
        if (!target.parentIds?.some(id => transition.sourceIds.includes(id))) {
          throw new Error(
            `Duplicate target ${targetId} is not linked to a source`,
          );
        }
      }
    }

    if (
      transition.operation === 'split' &&
      (transition.sourceIds.length !== 1 || transition.targetIds.length < 2)
    ) {
      throw new Error(
        `Split transition ${transition.id} requires one source and multiple targets`,
      );
    }
    if (transition.operation === 'split') {
      const sourceId = transition.sourceIds[0];
      for (const targetId of transition.targetIds) {
        const target = entities.get(targetId)!;
        if (
          target.lineage !== 'split' ||
          !target.parentIds?.includes(sourceId)
        ) {
          throw new Error(
            `Split target ${targetId} must descend from ${sourceId}`,
          );
        }
      }
    }

    if (
      transition.operation === 'merge' &&
      (transition.sourceIds.length < 2 || transition.targetIds.length !== 1)
    ) {
      throw new Error(
        `Merge transition ${transition.id} requires multiple sources and one target`,
      );
    }
    if (transition.operation === 'merge') {
      const target = entities.get(transition.targetIds[0])!;
      if (
        target.lineage !== 'merge' ||
        !transition.sourceIds.every(id => target.parentIds?.includes(id))
      ) {
        throw new Error(
          `Merge target ${target.id} must descend from every source`,
        );
      }
    }

    if (transition.operation === 'aggregate') {
      if (
        transition.sourceIds.length < 1 ||
        transition.targetIds.length !== 1
      ) {
        throw new Error(
          `Aggregate transition ${transition.id} needs sources and one target`,
        );
      }
      const target = entities.get(transition.targetIds[0])!;
      if (
        target.lineage !== 'aggregate' ||
        !transition.sourceIds.every(id => target.parentIds?.includes(id))
      ) {
        throw new Error(
          `Aggregate target ${target.id} must retain every source`,
        );
      }
    }

    if (
      [
        'translate',
        'rotate',
        'scale',
        'deform',
        'rearrange',
        'focus',
        'recede',
      ].includes(transition.operation) &&
      !sameMembers(transition.sourceIds, transition.targetIds)
    ) {
      throw new Error(
        `${transition.operation} transition ${transition.id} must retain the same entity IDs`,
      );
    }

    if (
      transition.operation === 'replace' &&
      transition.preserves.includes('identity')
    ) {
      throw new Error(
        `Replacement transition ${transition.id} cannot preserve identity`,
      );
    }
    if (transition.operation === 'replace') {
      for (const targetId of transition.targetIds) {
        if (entities.get(targetId)?.lineage !== 'replacement') {
          throw new Error(
            `Replacement target ${targetId} must use replacement lineage`,
          );
        }
      }
    }

    if (
      transition.operation === 'summarize' &&
      !transition.targetIds.some(id => entities.get(id)?.role === 'conclusion')
    ) {
      throw new Error(
        `Summary transition ${transition.id} needs a conclusion target`,
      );
    }
    if (transition.operation === 'summarize') {
      for (const targetId of transition.targetIds) {
        const target = entities.get(targetId)!;
        if (
          target.role === 'conclusion' &&
          (target.lineage !== 'summary' ||
            !transition.sourceIds.some(id => target.parentIds?.includes(id)))
        ) {
          throw new Error(
            `Conclusion ${targetId} must retain evidence lineage`,
          );
        }
      }
    }

    if (
      transition.operation === 'replace' ||
      transition.operation === 'summarize'
    ) {
      for (const sourceId of transition.sourceIds) {
        consumedEntities.add(sourceId);
      }
    }
  }
}
