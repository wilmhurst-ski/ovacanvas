import type {SceneNode, Touch} from '../document/model.js';
import {isObject} from '../document/values.js';
import {ICON_HEX, hexColor} from '../icons/draw.js';
import {
  TEX_EM,
  asTerms,
  colorize,
  splitTerms,
  texHeightEmExact,
  texWidthEmExact,
} from '../tex/terms.js';
import {
  FieldErrors,
  PLACEMENT_FIELDS,
  checkPlacement,
  placementBox,
  texWidthEm,
} from './fields.js';
import type {KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

const FIELDS = ['steps', 'mode', 'fontSize', 'colors', ...PLACEMENT_FIELDS];
const MODES = ['stack', 'morph', 'flow'];
/** Relation symbols a flow of working lines up on. */
const RELATIONS = [
  '=',
  '\\ge',
  '\\le',
  '\\geq',
  '\\leq',
  '<',
  '>',
  '\\ne',
  '\\approx',
  '\\equiv',
  '\\Rightarrow',
  '\\iff',
];
/** Rendered em per MathJax em (its ex is half an em; the browser's is less). */
const EM = TEX_EM;
const MIN_FONT = 22;
/** Stack layout: space between an equation and its reason, and between rows. */
const WHY_GAP = 12;
const ROW_GAP = 30;

/**
 * A LaTeX string's rough rendered height in em: a line is about 1.25em, a
 * fraction roughly doubles it, and limits, sums, integrals, roots and
 * superscripts add a little more.
 */
export function texHeightEm(tex: string): number {
  let height = 1.25;
  const fractions = (tex.match(/\\[dt]?frac/g) ?? []).length;
  if (fractions) height += 1.1 + 0.5 * Math.min(2, fractions - 1);
  if (/\\(lim|sum|int|prod)_/.test(tex)) height += 0.5;
  if (/\\sqrt|\^\{/.test(tex)) height += 0.25;
  return height;
}

/** A row's height in em: exact when MathJax can lay it out. */
function rowHeightEm(tex: string): number {
  const exact = texHeightEmExact(tex);
  return exact === null ? texHeightEm(tex) : exact * TEX_EM + 0.1;
}

interface ParsedStep {
  tex: string;
  why?: string;
}

function parseSteps(node: KitNode, errors?: FieldErrors): ParsedStep[] {
  if (!Array.isArray(node.steps) || node.steps.length === 0) {
    errors?.error(
      'steps',
      'steps is a non-empty list of LaTeX strings or {"tex", "why"} objects',
    );
    return [];
  }
  const steps: ParsedStep[] = [];
  node.steps.forEach((step, i) => {
    if (typeof step === 'string') steps.push({tex: step});
    else if (isObject(step) && typeof step.tex === 'string') {
      if (step.why !== undefined && typeof step.why !== 'string') {
        errors?.error('steps', `steps[${i}].why must be a string`);
      }
      const extra = Object.keys(step).filter(k => k !== 'tex' && k !== 'why');
      if (extra.length) {
        errors?.error(
          'steps',
          `steps[${i}] has unknown key(s) ${extra.join(', ')}`,
          'a step is {"tex", "why"?}',
        );
      }
      steps.push({
        tex: step.tex,
        ...(typeof step.why === 'string' ? {why: step.why} : {}),
      });
    } else {
      errors?.error(
        'steps',
        `steps[${i}] must be a LaTeX string or {"tex": "...", "why"?: "..."}`,
      );
    }
    if (
      typeof step === 'string'
        ? !step.trim()
        : isObject(step) && typeof step.tex === 'string' && !step.tex.trim()
    ) {
      errors?.error('steps', `steps[${i}] is empty`);
    }
  });
  return steps;
}

export const derivation: KitSpec = {
  name: 'derivation',
  summary:
    'A sequence of equations. "stack" (default) lays the steps out top to bottom, each with an optional reason; "flow" stacks them too, but each new line comes out of the line above - the terms that carry over slide down into place, lined up on the = sign; "morph" shows one equation that morphs from step to step (matching terms travel), with the reason as a note beneath it.',
  fields: {
    steps: {
      type: '["tex", ...] or [{"tex": "...", "why"?: "..."}]',
      required: true,
      doc: 'The equations, in order. "why" is LaTeX in stack mode (e.g. "\\\\text{from } \\\\triangle ABC") and plain words in morph mode.',
    },
    mode: {type: '"stack" | "flow" | "morph"', doc: 'Default "stack".'},
    colors: {
      type: '{"x": "blue", "y": "coral"}',
      doc: 'Colour a symbol wherever it appears in every step, so each role keeps its colour as the working moves.',
    },
    fontSize: {
      type: 'number',
      doc: 'Equation size, default 40; long steps shrink to fit the region.',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where the derivation goes (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box instead of a region.',
    },
  },
  parts:
    '"<id>.0", "<id>.1", ... one step (with its reason) - in flow mode, showing a step brings it out of the one above; in morph mode, `morph: "<id>.2"` morphs the equation to step 2',
  example: {
    id: 'proof',
    kit: 'derivation',
    region: 'right',
    steps: [
      {tex: 'a^2 + b^2 = c^2'},
      {tex: 'c = \\sqrt{a^2 + b^2}', why: '\\text{take square roots}'},
    ],
  },

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(FIELDS);
    checkPlacement(node, errors);
    const steps = parseSteps(node, errors);
    if (node.mode !== undefined && !MODES.includes(node.mode as string)) {
      errors.error(
        'mode',
        `mode must be "stack", "flow" or "morph", got ${JSON.stringify(node.mode)}`,
      );
    }
    if (node.colors !== undefined) {
      if (
        !isObject(node.colors) ||
        Object.values(node.colors).some(v => typeof v !== 'string')
      ) {
        errors.error(
          'colors',
          'colors is {"<symbol>": "<colour>"}, e.g. {"x": "blue"}',
        );
      }
    }
    if (
      node.fontSize !== undefined &&
      (typeof node.fontSize !== 'number' ||
        node.fontSize < MIN_FONT ||
        node.fontSize > 96)
    ) {
      errors.error(
        'fontSize',
        `fontSize must be a number from ${MIN_FONT} to 96`,
      );
    }
    if (
      node.mode === 'morph' &&
      steps.some(s => s.why && /\\[a-zA-Z]|[_^]\{/.test(s.why))
    ) {
      errors.error(
        'steps',
        'in morph mode "why" is a plain-words note - put math in the steps themselves',
      );
    }
    return errors.issues;
  },

  expand(node): KitExpansion {
    const colors = isObject(node.colors)
      ? Object.fromEntries(
          Object.entries(node.colors).map(([k, v]) => [
            k,
            hexColor(typeof v === 'string' ? v : undefined, ICON_HEX.blue),
          ]),
        )
      : null;
    const steps = parseSteps(node).map(step =>
      colors ? {...step, tex: colorize(step.tex, colors)} : step,
    );
    const box = placementBox(node);
    const base = typeof node.fontSize === 'number' ? node.fontSize : 40;
    const fit = (tex: string, size: number) =>
      Math.max(
        MIN_FONT,
        Math.min(
          size,
          Math.floor(
            (box.width * 0.92) /
              Math.max(1, texWidthEm(tex.replace(/\\textcolor\{[^}]*\}/g, ''))),
          ),
        ),
      );
    const nodes: SceneNode[] = [];
    const touches: Touch[] = [];
    const parts = new Map<string, KitPart>();
    const id = node.id;

    if (node.mode === 'morph') {
      const eqId = `${id}_eq`;
      const noteId = `${id}_note`;
      const size = Math.min(...steps.map(s => fit(s.tex, Math.max(base, 56))));
      nodes.push({
        id: eqId,
        component: 'Latex',
        props: {
          tex: asTerms(steps[0].tex),
          fontSize: size,
          position: [box.x, box.y - 40],
        },
      });
      const hasNotes = steps.some(s => s.why);
      if (hasNotes) {
        nodes.push({
          id: noteId,
          component: 'Txt',
          props: {
            position: [box.x, box.y + 150],
            text: steps[0].why ?? ' ',
            fontSize: 30,
            fill: {theme: 'secondaryInk'},
            ...(steps[0].why ? {} : {opacity: 0}),
          },
        });
      }
      steps.forEach((step, i) => {
        parts.set(String(i), {
          nodes: [eqId],
          morph: {
            node: eqId,
            tex: asTerms(step.tex),
            ...(hasNotes ? {note: {node: noteId, text: step.why ?? ''}} : {}),
          },
        });
      });
      return {nodes, touches, parts};
    }

    // Stack: each row is as tall as its equation really is (fractions,
    // limits and roots are taller than a line), a reason sits under its
    // equation, and the whole stack is scaled to fit the region.
    const rows = steps.map(step => {
      const size = fit(step.tex, base);
      const whySize = step.why ? fit(step.why, Math.round(base * 0.62)) : 0;
      return {
        size,
        whySize,
        // As MathJax lays it out (a limit or a sum with bounds is taller
        // than any rule of thumb), with the estimate as a fallback.
        eqHeight: rowHeightEm(step.tex) * size,
        whyHeight: step.why
          ? Math.max(1.3, rowHeightEm(step.why)) * whySize
          : 0,
      };
    });
    const natural =
      rows.reduce(
        (sum, r) =>
          sum + r.eqHeight + (r.whyHeight ? WHY_GAP + r.whyHeight : 0),
        0,
      ) +
      ROW_GAP * (rows.length - 1);
    const scale = Math.min(1, box.height / natural);
    let y = box.y - (natural * scale) / 2;

    // Flow: every line is lined up on its relation (=, >=, ...) and the
    // terms of each line come down out of the line above.
    const flow = node.mode === 'flow';
    const shapes = steps.map(step => {
      const tex = flow ? asTerms(step.tex) : step.tex;
      const terms = Array.isArray(tex)
        ? tex
        : (splitTerms(step.tex) ?? [step.tex]);
      const at = terms.findIndex(t => RELATIONS.includes(t.trim()));
      const whole = flow ? texWidthEmExact(step.tex) : null;
      const left =
        flow && at > 0 ? texWidthEmExact(terms.slice(0, at).join('')) : null;
      return {tex, whole, left};
    });
    const sizes = rows.map(r => Math.max(MIN_FONT, Math.round(r.size * scale)));
    const leftMost = Math.max(
      0,
      ...shapes.map((sh, i) => (sh.left ?? 0) * sizes[i] * EM),
    );
    const rightMost = Math.max(
      0,
      ...shapes.map(
        (sh, i) => ((sh.whole ?? 0) - (sh.left ?? 0)) * sizes[i] * EM,
      ),
    );
    // The column the relations line up in, with the block centred.
    const column = box.x + (leftMost - rightMost) / 2;
    const rowX = (i: number) => {
      const sh = shapes[i];
      if (!flow || sh.whole === null || sh.left === null) return box.x;
      return Math.round(column + (sh.whole / 2 - sh.left) * sizes[i] * EM);
    };
    const placed: {x: number; y: number}[] = [];
    steps.forEach((step, i) => {
      const row = rows[i];
      const stepId = `${id}_s${i}`;
      const eqHeight = row.eqHeight * scale;
      const rowY = Math.round(y + eqHeight / 2);
      placed.push({x: rowX(i), y: rowY});
      nodes.push({
        id: stepId,
        component: 'Latex',
        props: {
          tex: shapes[i].tex,
          fontSize: sizes[i],
          position: [rowX(i), rowY],
        },
      });
      y += eqHeight;
      const partNodes = [stepId];
      if (step.why) {
        const whyId = `${id}_w${i}`;
        const whyHeight = row.whyHeight * scale;
        y += WHY_GAP * scale;
        nodes.push({
          id: whyId,
          component: 'Latex',
          props: {
            tex: step.why,
            fontSize: Math.max(16, Math.round(row.whySize * scale)),
            fill: {theme: 'secondaryInk'},
            position: [box.x, Math.round(y + whyHeight / 2)],
          },
        });
        y += whyHeight;
        partNodes.push(whyId);
      }
      if (flow && i > 0) {
        // It starts on top of the line above, and passes that line's reason.
        touches.push({
          a: `${id}_s${i - 1}`,
          b: stepId,
          reason: 'a line of working comes out of the line above',
        });
        if (steps[i - 1].why) {
          touches.push({
            a: `${id}_w${i - 1}`,
            b: stepId,
            reason: 'a new line moves down past the reason above it',
          });
        }
      }
      parts.set(String(i), {
        nodes: partNodes,
        // In a flow, a line comes out of the one above: it starts as a copy
        // of that line, in its place, and its terms move down into this one.
        ...(flow && i > 0
          ? {
              emerge: {
                after: String(i - 1),
                nodes: [
                  {
                    node: stepId,
                    from: {
                      tex: shapes[i - 1].tex,
                      position: [placed[i - 1].x, placed[i - 1].y],
                      ...(sizes[i - 1] !== sizes[i]
                        ? {fontSize: sizes[i - 1]}
                        : {}),
                    },
                  },
                ],
              },
            }
          : {}),
      });
      y += ROW_GAP * scale;
    });
    return {nodes, touches, parts};
  },
};
