import type {IntentValidationResult, PresentationGenre} from './types';

export interface TimelineEvent {
  /** The text label naming this event or milestone. */
  readonly label: string;
  /** Numerical coordinate along the timeline axis (year, index, or timestamp). */
  readonly position: number;
  /** Optional secondary note or detail for this event. */
  readonly note?: string;
}

export interface TimelineIntent {
  readonly title: string;
  readonly events: readonly TimelineEvent[];
}

export const MIN_EVENTS = 2;
export const MAX_EVENTS = 6;

const AXIS_START_X = -650;
const AXIS_END_X = 650;
const AXIS_Y = 60;
const TOTAL_SPAN = AXIS_END_X - AXIS_START_X;

/**
 * The reference implementation of the "timeline" presentation genre.
 *
 * @remarks
 * Models events or sequential stages positioned along a single line axis.
 * Uses `AnchoredLabel` to attach labels to axis markers without hand-computed
 * drift, and generates a verified audit spec and choreography plan.
 */
export class TimelineGenre implements PresentationGenre<TimelineIntent> {
  public readonly id = 'timeline';

  public matchesStructure(intent: unknown): boolean {
    if (
      typeof intent !== 'object' ||
      intent === null ||
      Array.isArray(intent)
    ) {
      return false;
    }
    const candidate = intent as Record<string, unknown>;
    return (
      Array.isArray(candidate.events) && candidate.events.length >= MIN_EVENTS
    );
  }

  public validateIntent(
    value: unknown,
  ): IntentValidationResult<TimelineIntent> {
    if (!this.matchesStructure(value)) {
      return {
        valid: false,
        errors: [
          `Intent must be an object with an "events" array containing at least ${MIN_EVENTS} events.`,
        ],
      };
    }
    const candidate = value as Record<string, unknown>;
    const errors: string[] = [];

    if (typeof candidate.title !== 'string' || !candidate.title.trim()) {
      errors.push('"title" must be a non-empty string.');
    }

    const rawEvents = candidate.events as unknown[];
    if (rawEvents.length > MAX_EVENTS) {
      errors.push(
        `Too many events (${rawEvents.length}). Maximum is ${MAX_EVENTS} to fit safely on screen without crowding.`,
      );
    }

    const validatedEvents: TimelineEvent[] = [];
    for (const [index, item] of rawEvents.entries()) {
      if (typeof item !== 'object' || item === null) {
        errors.push(`events[${index}] must be an object.`);
        continue;
      }
      const raw = item as Record<string, unknown>;
      if (typeof raw.label !== 'string' || !raw.label.trim()) {
        errors.push(`events[${index}].label must be a non-empty string.`);
      }
      if (typeof raw.position !== 'number' || !Number.isFinite(raw.position)) {
        errors.push(`events[${index}].position must be a finite number.`);
      }
      if (
        raw.note !== undefined &&
        (typeof raw.note !== 'string' || !raw.note.trim())
      ) {
        errors.push(
          `events[${index}].note must be a non-empty string when provided.`,
        );
      }

      if (typeof raw.label === 'string' && typeof raw.position === 'number') {
        validatedEvents.push({
          label: raw.label.trim(),
          position: raw.position,
          ...(typeof raw.note === 'string' && raw.note.trim()
            ? {note: raw.note.trim()}
            : {}),
        });
      }
    }

    if (errors.length > 0) {
      return {valid: false, errors};
    }

    // Sort events by position ascending
    validatedEvents.sort((a, b) => a.position - b.position);

    return {
      valid: true,
      intent: {
        title: (candidate.title as string).trim(),
        events: validatedEvents,
      },
    };
  }

  public compileIntentToSource(intent: TimelineIntent): string {
    const events = intent.events;
    const count = events.length;
    const minPos = events[0].position;
    const maxPos = events[count - 1].position;
    const posRange = maxPos - minPos;

    // Calculate marker X coordinates
    const markerXs = events.map((event, idx) => {
      if (posRange > 0) {
        const fraction = (event.position - minPos) / posRange;
        return AXIS_START_X + fraction * TOTAL_SPAN;
      }
      return AXIS_START_X + (idx / Math.max(1, count - 1)) * TOTAL_SPAN;
    });

    // Stagger label origins top/bottom to prevent collision
    const labelOrigins = events.map((_, idx) =>
      idx % 2 === 0 ? 'Origin.Bottom' : 'Origin.Top',
    );

    const markerNames = events.map((_, idx) => `marker_${idx}`);
    const labelNames = events.map((_, idx) => `label_${idx}`);

    const markerInstantiations = events.map((event, idx) => {
      const x = Math.round(markerXs[idx]);
      const origin = labelOrigins[idx];
      return `  ${markerNames[idx]} = new Circle({
    size: 24,
    fill: theme().blue,
    position: [${x}, ${AXIS_Y}],
  });
  ${labelNames[idx]} = new AnchoredLabel({
    anchor: ${markerNames[idx]},
    origin: ${origin},
    distance: 35,
    text: ${JSON.stringify(event.label + (event.note ? ` (${event.note})` : ''))},
    fontSize: 22,
    fill: theme().ink,
  });`;
    });

    const animationSteps = events.map((_event, idx) => {
      return `  yield* ${markerNames[idx]}.size(32, 0.2).to(24, 0.2);
  yield* waitFor(0.3);`;
    });

    const auditItems = [
      `      {id: 'title', node: title, halo: 10},`,
      `      {
        id: 'axis',
        node: axis,
        halo: 6,
        mayTouch: new Map([
${markerNames.map(m => `          ['${m}', 'markers sit along axis line'],`).join('\n')}
        ]),
      },`,
      ...events.map((_, idx) => {
        const m = markerNames[idx];
        const l = labelNames[idx];
        return `      {
        id: '${m}',
        node: ${m},
        halo: 6,
        mayTouch: new Map([
          ['axis', 'marker sits along axis line'],
          ['${l}', 'label is anchored to this marker'],
        ]),
      },
      {
        id: '${l}',
        node: ${l},
        halo: 6,
        mayTouch: new Map([['${m}', 'label is anchored to this marker']]),
      },`;
      }),
    ];

    const allRequiredIds = [
      "'title'",
      "'axis'",
      ...markerNames.map(m => `'${m}'`),
      ...labelNames.map(l => `'${l}'`),
    ];

    const choreographyEntities = [
      `    {id: 'title', role: 'context', lineage: 'root', recognizableBy: ['title text']},`,
      `    {id: 'axis', role: 'context', lineage: 'root', recognizableBy: ['timeline line']},`,
      ...events.map(
        (event, idx) =>
          `    {id: '${markerNames[idx]}', role: 'subject', lineage: 'root', recognizableBy: [${JSON.stringify(event.label)}]},`,
      ),
    ];

    const choreographyTransitions = events.map((event, idx) => {
      return `    {
      id: 'event_${idx + 1}',
      sourceIds: ['${markerNames[idx]}'],
      targetIds: ['${markerNames[idx]}'],
      operation: 'focus',
      preserves: ['position'],
      changes: ['scale'],
      purpose: ${JSON.stringify(`reveal ${event.label}`)},
      holdAfter: 'hold_event_${idx + 1}',
    },`;
    });

    return `import {AnchoredLabel, Circle, Line, Txt, makeScene2D, theme} from '@ovacanvas/2d';
import {BBox, Origin, Vector2, waitFor} from '@ovacanvas/core';

let title: Txt;
let axis: Line;
${markerNames.map(m => `let ${m}: Circle;`).join('\n')}
${labelNames.map(l => `let ${l}: AnchoredLabel;`).join('\n')}

export default makeScene2D(function* (view) {
  title = new Txt({
    text: ${JSON.stringify(intent.title)},
    fontSize: 40,
    fontWeight: 700,
    position: [0, -420],
  });

  axis = new Line({
    points: [new Vector2(${AXIS_START_X - 40}, ${AXIS_Y}), new Vector2(${AXIS_END_X + 40}, ${AXIS_Y})],
    lineWidth: 4,
    stroke: theme().hairline,
  });

${markerInstantiations.join('\n')}

  view.add([title, axis, ${markerNames.join(', ')}, ${labelNames.join(', ')}]);

${animationSteps.join('\n')}
  yield* waitFor(0.5);
});

export function buildAuditSpec() {
  return {
    items: [
${auditItems.join('\n')}
    ],
    requiredIds: [${allRequiredIds.join(', ')}],
    safeArea: new BBox(60, 60, 1800, 960),
  };
}

export const choreographyPlan = {
  entities: [
${choreographyEntities.join('\n')}
  ],
  transitions: [
${choreographyTransitions.join('\n')}
  ],
};
`;
  }
}

export const timelineGenre = new TimelineGenre();
