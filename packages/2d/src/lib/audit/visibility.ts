import type {AuditFinding, AuditItem} from './types';
import {isItemVisible} from './types';

/**
 * Required items that are registered but not actually visible.
 *
 * @remarks
 * This closes a real hole in the gate, found by rendering a beat and looking
 * at it: **every other check filters through `isItemVisible`**, so a scene
 * whose nodes are all at opacity 0 - the natural shape of an
 * entrance-animated beat - is checked against nothing and passes. The result
 * is a beat that reports `passed: true` and shows the learner an empty canvas,
 * which is precisely the outcome the whole gate exists to prevent.
 *
 * Registration is not the same as visibility, and the existing coverage check
 * only tests the former: it asks "is there an item with this id", not "is the
 * thing that id names actually on screen". A scene can therefore satisfy
 * `requiredIds` completely while drawing nothing at all.
 *
 * Opt-in rather than always-on, because whether an invisible required item is
 * a defect depends on *when* it is checked. At the readiness gate - the frame
 * a beat is presented on - a required item that draws nothing is
 * unambiguously broken. Mid-timeline, the same item may simply be fading in,
 * and flagging it would make every entrance-animated scene fail. So the
 * caller decides, and `BeatAdapter` asks for it at the frame-0 gate only.
 */
export function collectInvisibleRequiredItems(
  items: readonly AuditItem[],
  requiredIds: readonly string[],
): AuditFinding[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const invisible = requiredIds.filter(id => {
    const item = byId.get(id);
    // A missing item is `collectCoverageGaps`'s finding, not this one -
    // reporting it twice would just be noise on the same defect.
    return item !== undefined && !isItemVisible(item);
  });

  if (invisible.length === 0) return [];
  return [
    {
      ruleId: 'invisible-required-item',
      severity: 'blocking',
      entities: invisible,
      message:
        `Required content is registered but not visible: ${invisible.join(', ')}. ` +
        'Every check in this audit skips items that draw nothing, so a scene whose ' +
        'required nodes are all at opacity 0 passes every other rule while showing the ' +
        'learner an empty canvas. Make the required content visible at the frame this ' +
        'beat is presented on, rather than fading it in from nothing.',
    },
  ];
}
