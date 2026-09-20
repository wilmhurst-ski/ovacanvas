import {BBox} from '@ovacanvas/core';
import {describe, expect, it} from 'vitest';
import {
  DEFAULT_COMPOSITION_THRESHOLDS,
  collectCompositionFindings,
  measureComposition,
  usefulBoardArea,
} from './composition';
import {evaluateVisualAudit} from './report';
import {StubAuditNode} from './testing/StubAuditNode';
import type {AuditItem} from './types';

/**
 * The calibration corpus for the composition thresholds.
 *
 * @remarks
 * These numbers are measured, not invented - the same method the
 * implicit-containment threshold in `collisions.ts` was calibrated by. Each
 * fixture below states which side of the line it is meant to fall on, and the
 * test both asserts that and prints the measurement, so a change to the
 * geometry or the thresholds cannot silently invalidate the constants in
 * `composition.ts`. If a fixture starts landing on the wrong side, the
 * threshold needs re-deriving rather than the fixture needs adjusting.
 *
 * Coordinates are canvas space (1920x1080, origin top-left), which is the
 * space `worldBBox()` reports in.
 */
const SAFE_AREA = new BBox(60, 60, 1800, 960);
const TITLE = {x: 960, y: 120, width: 600, height: 50};

type Placement = readonly [x: number, y: number, width: number, height: number];

function scene(
  placements: readonly Placement[],
  withTitle = true,
): AuditItem[] {
  const nodes = withTitle
    ? [{x: TITLE.x, y: TITLE.y, w: TITLE.width, h: TITLE.height}]
    : [];
  for (const [x, y, width, height] of placements)
    {nodes.push({x, y, w: width, h: height});}
  return nodes.map((node, index) => {
    const stub = new StubAuditNode(`item-${index}`, {
      x: node.x,
      y: node.y,
      width: node.w,
      height: node.h,
    });
    return {id: stub.key, node: stub, halo: 0};
  });
}

interface Fixture {
  readonly name: string;
  /**
   * The exact set of rule ids this fixture must produce, in order.
   *
   * @remarks
   * Exact rather than "contains", so a fixture cannot pass because an
   * unrelated check happened to fire. Some fixtures legitimately trip more
   * than one check - content crammed into a corner is both too sparse *and*
   * pressed against the edges - and naming both is more honest than nudging
   * the fixture until only one fires.
   */
  readonly expectRules: readonly string[];
  readonly items: AuditItem[];
}

const CORPUS: readonly Fixture[] = [
  {
    name: 'good: heading plus three pieces spread across the board',
    expectRules: [],
    items: scene([
      [400, 400, 300, 200],
      [960, 420, 300, 200],
      [1520, 400, 300, 200],
    ]),
  },
  {
    name: 'good: a four-cell grid',
    expectRules: [],
    items: scene([
      [500, 380, 300, 180],
      [500, 720, 300, 180],
      [1400, 380, 300, 180],
      [1400, 720, 300, 180],
    ]),
  },
  {
    name: 'good: a diagram with a heading, which must not be counted as content',
    expectRules: [],
    items: scene([
      [700, 500, 500, 400],
      [1400, 500, 260, 120],
    ]),
  },
  {
    name: 'bad: everything crammed into one corner',
    expectRules: ['composition-occupancy', 'composition-breathing-room'],
    items: scene([
      [180, 950, 160, 100],
      [360, 950, 160, 100],
      [180, 810, 160, 100],
    ]),
  },
  {
    name: 'bad: content filling almost the whole board',
    expectRules: ['composition-occupancy', 'composition-breathing-room'],
    items: scene([
      [480, 380, 800, 350],
      [1440, 380, 800, 350],
      [480, 850, 800, 350],
      [1440, 850, 800, 350],
    ]),
  },
  {
    name: 'bad: content pressed against one edge',
    expectRules: ['composition-breathing-room'],
    items: scene([
      [1300, 400, 300, 200],
      [1700, 400, 300, 200],
      [1700, 700, 300, 200],
    ]),
  },
  {
    // Positioned so that ONLY alignment fires: this fixture isolates the
    // check it names, rather than passing because something else tripped.
    name: 'bad: six pieces, nothing lining up with anything',
    expectRules: ['composition-alignment'],
    items: scene([
      [350, 350, 140, 100],
      [700, 560, 140, 100],
      [1150, 380, 140, 100],
      [1500, 660, 140, 100],
      [600, 860, 140, 100],
      [1250, 890, 140, 100],
    ]),
  },
];

describe('usefulBoardArea', () => {
  it('reserves the heading band at the top of the safe area', () => {
    const useful = usefulBoardArea(SAFE_AREA);
    expect(useful.top).toBe(
      SAFE_AREA.top + DEFAULT_COMPOSITION_THRESHOLDS.titleZoneHeight,
    );
    expect(useful.bottom).toBe(SAFE_AREA.bottom);
    expect(useful.left).toBe(SAFE_AREA.left);
    expect(useful.right).toBe(SAFE_AREA.right);
  });

  it('accepts a list of safe areas, judging against the first', () => {
    const useful = usefulBoardArea([SAFE_AREA, new BBox(0, 0, 1920, 1080)]);
    expect(useful.left).toBe(SAFE_AREA.left);
  });
});

describe('composition thresholds, measured against the corpus', () => {
  it('holds the separation the thresholds were derived from', () => {
    for (const fixture of CORPUS) {
      const measured = measureComposition(fixture.items, SAFE_AREA);
      const findings = collectCompositionFindings(fixture.items, SAFE_AREA);

      console.log(
        `${fixture.name}\n` +
          `    occupancy=${measured.occupancy.toFixed(4)} breathingRoom=${Math.round(
            measured.breathingRoom,
          )} unaligned=${measured.unalignedFraction.toFixed(2)} items=${measured.visibleItems}\n` +
          `    findings=[${findings.map(finding => finding.ruleId).join(', ')}]`,
      );

      // Exact set either way: an empty list is the claim that matters for a
      // well-composed scene, and for a bad one it proves the named checks
      // fired rather than something unrelated.
      expect(
        findings.map(finding => finding.ruleId),
        fixture.name,
      ).toEqual(fixture.expectRules);
    }
  });

  it('scores the crammed fixture well below the floor and the good ones well above it', () => {
    const occupancyOf = (name: string) => {
      const fixture = CORPUS.find(entry => entry.name.includes(name));
      if (!fixture) throw new Error(`no fixture matching ${name}`);
      return measureComposition(fixture.items, SAFE_AREA).occupancy;
    };

    const crammed = occupancyOf('crammed');
    const grid = occupancyOf('four-cell grid');
    const spread = occupancyOf('spread across the board');

    // The separation is what makes the threshold meaningful, so assert it
    // directly rather than only asserting the findings that follow from it.
    expect(crammed).toBeLessThan(DEFAULT_COMPOSITION_THRESHOLDS.minOccupancy);
    expect(grid).toBeGreaterThan(DEFAULT_COMPOSITION_THRESHOLDS.minOccupancy);
    expect(spread).toBeGreaterThan(DEFAULT_COMPOSITION_THRESHOLDS.minOccupancy);
    expect(grid).toBeLessThan(DEFAULT_COMPOSITION_THRESHOLDS.maxOccupancy);
    expect(spread).toBeLessThan(DEFAULT_COMPOSITION_THRESHOLDS.maxOccupancy);
  });

  it('never blocks, whatever it finds', () => {
    for (const fixture of CORPUS) {
      for (const finding of collectCompositionFindings(
        fixture.items,
        SAFE_AREA,
      )) {
        expect(finding.severity, `${fixture.name} / ${finding.ruleId}`).toBe(
          'advisory',
        );
      }
    }
  });

  it('stays silent when there is nothing visible to judge', () => {
    const invisible = new StubAuditNode('ghost', {
      width: 100,
      height: 100,
      opacity: 0,
    });
    const items: AuditItem[] = [{id: 'ghost', node: invisible, halo: 0}];
    // A blank board is the visibility check's finding, not this one's - two
    // findings for one defect would send a caller after the wrong fix.
    expect(collectCompositionFindings(items, SAFE_AREA)).toEqual([]);
  });
});

describe('evaluateVisualAudit with includeComposition', () => {
  const crammed = CORPUS.find(fixture =>
    fixture.name.includes('crammed'),
  )!.items;

  it('flags a badly-composed scene that every geometric check is happy with', () => {
    // The Phase 6 acceptance claim, stated exactly: this scene collides with
    // nothing, escapes nothing, and is still bad - everything jammed into one
    // corner of an otherwise empty board.
    const geometric = evaluateVisualAudit({
      items: crammed,
      safeArea: SAFE_AREA,
      requiredIds: crammed.map(item => item.id),
    });
    expect(geometric.passed).toBe(true);
    expect(geometric.findings).toEqual([]);

    const withComposition = evaluateVisualAudit({
      items: crammed,
      safeArea: SAFE_AREA,
      requiredIds: crammed.map(item => item.id),
      includeComposition: true,
    });
    expect(withComposition.findings.map(finding => finding.ruleId)).toContain(
      'composition-occupancy',
    );
    // ...and it still passes. Composition can never be why a correct beat
    // fails to reach a learner.
    expect(withComposition.passed).toBe(true);
  });

  it('leaves composition out unless it is asked for', () => {
    const report = evaluateVisualAudit({
      items: crammed,
      safeArea: SAFE_AREA,
      requiredIds: crammed.map(item => item.id),
    });
    expect(report.findings.map(finding => finding.ruleId)).not.toContain(
      'composition-occupancy',
    );
  });
});
