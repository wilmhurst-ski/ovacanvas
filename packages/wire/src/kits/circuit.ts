import type {SceneNode, Step, Touch, Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import {ICON_HEX, drawIcon} from '../icons/draw.js';
import {resolveIcon, type IconDef} from '../icons/library.js';
import {ELECTRICAL} from '../icons/symbols.js';
import {
  FieldErrors,
  PLACEMENT_FIELDS,
  checkPlacement,
  mixedTextToTex,
  placementBox,
} from './fields.js';
import type {KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

// ---- the circuit expression -------------------------------------------------------

/** "B1 - S1 - (R1 | L1 - R2)": "-" in series, "|" in parallel, brackets group. */
type Expr =
  | {kind: 'part'; id: string}
  | {kind: 'series'; items: Expr[]}
  | {kind: 'parallel'; branches: Expr[]};

class ExprError extends Error {}

function parseCircuit(source: string): Expr {
  const tokens = source.match(/[A-Za-z_][A-Za-z0-9_]*|[-|()]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  // alternatives := series ('|' series)*
  const alternatives = (): Expr => {
    const branches = [series()];
    while (peek() === '|') {
      i++;
      branches.push(series());
    }
    return branches.length === 1 ? branches[0] : {kind: 'parallel', branches};
  };
  // series := atom ('-' atom)*
  const series = (): Expr => {
    const items = [atom()];
    while (peek() === '-') {
      i++;
      items.push(atom());
    }
    return items.length === 1 ? items[0] : {kind: 'series', items};
  };
  const atom = (): Expr => {
    const t = tokens[i++];
    if (t === undefined) throw new ExprError('the circuit ends too early');
    if (t === '(') {
      const inner = alternatives();
      if (tokens[i++] !== ')') throw new ExprError('a "(" is not closed');
      return inner;
    }
    if (/^[A-Za-z_]/.test(t)) return {kind: 'part', id: t};
    throw new ExprError(`unexpected "${t}"`);
  };
  const tree = alternatives();
  if (i < tokens.length) throw new ExprError(`unexpected "${tokens[i]}"`);
  return tree;
}

function partIds(expr: Expr): string[] {
  if (expr.kind === 'part') return [expr.id];
  return (expr.kind === 'series' ? expr.items : expr.branches).flatMap(partIds);
}

// ---- parts ------------------------------------------------------------------------

interface Part {
  id: string;
  icon: IconDef;
  label: string;
}

// A part: "resistor", "resistor: 10 Ω", or an object with symbol and label.
function partSpec(raw: Value): {symbol: string; label?: string} | null {
  if (typeof raw === 'string') {
    const colon = raw.indexOf(':');
    return colon === -1
      ? {symbol: raw.trim()}
      : {
          symbol: raw.slice(0, colon).trim(),
          label: raw.slice(colon + 1).trim(),
        };
  }
  if (isObject(raw) && typeof raw.symbol === 'string') {
    return {
      symbol: raw.symbol,
      ...(typeof raw.label === 'string' ? {label: raw.label} : {}),
    };
  }
  return null;
}

/** A symbol a circuit can use: two terminals, drawn left to right. */
function circuitSymbol(name: string): IconDef | null {
  const def = resolveIcon(name, {preferSymbols: true});
  const t = def?.symbol?.terminals;
  return def && t && t.a && t.b && t.a[1] === 0 && t.b[1] === 0 ? def : null;
}

const TWO_TERMINAL = Object.entries(ELECTRICAL)
  .filter(([, s]) => s.terminals.a && s.terminals.b && s.terminals.a[1] === 0)
  .map(([name]) => name);

// ---- layout -------------------------------------------------------------------------

const SYMBOL = 96; // a symbol's width at scale 1, leads included
const GAP = 36; // wire between two parts in series
const LEAD = 30; // from a parallel bus to its branches
const LABEL = 34; // room for a label above a part

interface Wire {
  points: [number, number][];
  /** Whether current flows here when the circuit runs. */
  live: boolean;
}

interface Placed {
  part: Part;
  x: number; // centre
  y: number;
  live: boolean;
  labelBelow: boolean;
}

interface Block {
  width: number;
  up: number;
  down: number;
  parts: Placed[];
  wires: Wire[];
  dots: [number, number][];
  conducts: boolean;
}

function symbolExtent(part: Part): number {
  return Math.max(8, (part.icon.symbol?.halfHeight ?? 10) * 2);
}

function layoutExpr(expr: Expr, parts: ReadonlyMap<string, Part>): Block {
  if (expr.kind === 'part') {
    const part = parts.get(expr.id)!;
    const half = symbolExtent(part);
    return {
      width: SYMBOL,
      up: half + LABEL,
      down: half,
      parts: [{part, x: SYMBOL / 2, y: 0, live: true, labelBelow: false}],
      wires: [],
      dots: [],
      conducts: !part.icon.symbol?.open,
    };
  }
  if (expr.kind === 'series') {
    const blocks = expr.items.map(item => layoutExpr(item, parts));
    const conducts = blocks.every(b => b.conducts);
    const out: Block = {
      width: 0,
      up: 0,
      down: 0,
      parts: [],
      wires: [],
      dots: [],
      conducts,
    };
    blocks.forEach((block, k) => {
      if (k > 0) {
        out.wires.push({
          points: [
            [out.width, 0],
            [out.width + GAP, 0],
          ],
          live: true,
        });
        out.width += GAP;
      }
      out.parts.push(...block.parts.map(p => ({...p, x: p.x + out.width})));
      out.wires.push(
        ...block.wires.map(w => ({
          ...w,
          points: w.points.map(
            ([x, y]) => [x + out.width, y] as [number, number],
          ),
        })),
      );
      out.dots.push(
        ...block.dots.map(([x, y]) => [x + out.width, y] as [number, number]),
      );
      out.width += block.width;
      out.up = Math.max(out.up, block.up);
      out.down = Math.max(out.down, block.down);
    });
    return out;
  }
  // Parallel: branches stacked, joined by a bus on each side.
  const blocks = expr.branches.map(branch => layoutExpr(branch, parts));
  const inner = Math.max(...blocks.map(b => b.width));
  const width = inner + 2 * LEAD;
  const heights = blocks.map(b => b.up + b.down);
  const spacing = 18;
  const total =
    heights.reduce((a, b) => a + b, 0) + spacing * (blocks.length - 1);
  let cursor = -total / 2;
  const out: Block = {
    width,
    up: 0,
    down: 0,
    parts: [],
    wires: [],
    dots: [],
    conducts: blocks.some(b => b.conducts),
  };
  const ys: number[] = [];
  blocks.forEach(block => {
    const y = cursor + block.up;
    ys.push(y);
    const x0 = LEAD + (inner - block.width) / 2;
    const live = block.conducts;
    out.parts.push(
      ...block.parts.map(p => ({
        ...p,
        x: p.x + x0,
        y: p.y + y,
        live: p.live && live,
      })),
    );
    out.wires.push(
      ...block.wires.map(w => ({
        live: w.live && live,
        points: w.points.map(([x, py]) => [x + x0, py + y] as [number, number]),
      })),
      {
        points: [
          [0, 0],
          [0, y],
          [x0, y],
        ],
        live,
      },
      {
        points: [
          [x0 + block.width, y],
          [width, y],
          [width, 0],
        ],
        live,
      },
    );
    out.dots.push(
      ...block.dots.map(([x, py]) => [x + x0, py + y] as [number, number]),
    );
    cursor += block.up + block.down + spacing;
  });
  // Junction dots where a branch leaves or joins a bus, and where the bus
  // meets the wire coming in and going out.
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  for (const y of ys) {
    if (y !== top && y !== bottom) out.dots.push([0, y], [width, y]);
  }
  out.dots.push([0, 0], [width, 0]);
  out.up = -Math.min(...blocks.map((b, k) => ys[k] - b.up));
  out.down = Math.max(...blocks.map((b, k) => ys[k] + b.down));
  return out;
}

// ---- the kit --------------------------------------------------------------------------

const FIELDS = ['parts', 'circuit', 'current', 'seconds', ...PLACEMENT_FIELDS];

function parseParts(node: KitNode, errors?: FieldErrors): Map<string, Part> {
  const parts = new Map<string, Part>();
  if (!isObject(node.parts) || !Object.keys(node.parts).length) {
    errors?.error(
      'parts',
      'parts names each component: {"B1": "battery", "R1": "resistor: 10 Ω", "L1": "lamp"}',
    );
    return parts;
  }
  for (const [id, raw] of Object.entries(node.parts)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
      errors?.error(
        'parts',
        `"${id}" is not a usable part name`,
        'letters and digits, like "R1" or "lamp2"',
      );
      continue;
    }
    const spec = partSpec(raw);
    if (!spec) {
      errors?.error(
        'parts',
        `part "${id}" is a symbol name, "symbol: label", or {"symbol", "label"}`,
      );
      continue;
    }
    const icon = circuitSymbol(spec.symbol);
    if (!icon) {
      errors?.error(
        'parts',
        `part "${id}": "${spec.symbol}" is not a two-terminal circuit symbol`,
        `use one of ${TWO_TERMINAL.join(', ')}`,
      );
      continue;
    }
    parts.set(id, {id, icon, label: spec.label ?? id});
  }
  return parts;
}

export const circuit: KitSpec = {
  name: 'circuit',
  summary:
    'An electric circuit drawn as a textbook schematic from one line: "B1 - S1 - (R1 | L1)" ("-" in series, "|" in parallel, brackets group). The first part is the source, at the bottom; the rest runs across the top. `play` sends current round the wires - lamps and LEDs light up where it flows, and an open switch stops it.',
  fields: {
    parts: {
      type: '{id: "symbol" | "symbol: label"}',
      required: true,
      doc: 'Each component: {"B1": "battery: 9 V", "S1": "switch", "R1": "resistor: 100 Ω", "L1": "lamp"}. An open "switch" breaks the circuit; "closed-switch" does not.',
    },
    circuit: {
      type: 'string',
      doc: 'How they connect, round the loop from the source: "B1 - S1 - (R1 | L1 - R2)". Default: every part in series, in order.',
    },
    current: {
      type: '"conventional" | "electrons"',
      doc: "Which way the flow is shown: + to - (default) or the electrons' way.",
    },
    seconds: {
      type: 'number',
      doc: 'How long `play` runs the current (default 3).',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where it goes (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box.',
    },
  },
  parts:
    '"<id>.<part>" each component (trace draws it), "<id>.wires" (trace draws them), "<id>.current"; a beat with "play": "<id>" runs the current',
  // Part names are written the way a schematic labels them.
  /* eslint-disable @typescript-eslint/naming-convention */
  example: {
    id: 'torch',
    kit: 'circuit',
    parts: {
      B1: 'battery: 3 V',
      S1: 'closed-switch',
      L1: 'lamp',
      R1: 'resistor: 10 Ω',
    },
    circuit: 'B1 - S1 - (L1 | R1)',
  },
  /* eslint-enable @typescript-eslint/naming-convention */

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(FIELDS);
    checkPlacement(node, errors);
    const parts = parseParts(node, errors);
    if (node.circuit !== undefined) {
      if (typeof node.circuit !== 'string') {
        errors.error(
          'circuit',
          'circuit is one line, like "B1 - S1 - (R1 | L1)"',
        );
      } else {
        try {
          const tree = parseCircuit(node.circuit);
          if (tree.kind === 'parallel') {
            errors.error(
              'circuit',
              'the loop itself is a series from the source',
              'put parallel branches in brackets: "B1 - (R1 | R2)"',
            );
          }
          const used = partIds(tree);
          for (const id of used) {
            if (isObject(node.parts) && !(id in node.parts)) {
              errors.error(
                'circuit',
                `"${id}" is in the circuit but not in parts`,
              );
            }
          }
          const counts = new Map<string, number>();
          used.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
          for (const [id, n] of counts) {
            if (n > 1) {
              errors.error(
                'circuit',
                `"${id}" appears ${n} times; each part is in one place`,
              );
            }
          }
          if (used.length < 2) {
            errors.error('circuit', 'a circuit needs at least two parts');
          }
        } catch (error) {
          errors.error(
            'circuit',
            error instanceof ExprError ? error.message : String(error),
            '"-" joins in series, "|" in parallel, brackets group: "B1 - (R1 | R2)"',
          );
        }
      }
    } else if (parts.size < 2) {
      errors.error('parts', 'a circuit needs at least two parts');
    }
    if (
      node.current !== undefined &&
      node.current !== 'conventional' &&
      node.current !== 'electrons'
    ) {
      errors.error('current', 'current is "conventional" or "electrons"');
    }
    if (
      node.seconds !== undefined &&
      !(
        typeof node.seconds === 'number' &&
        node.seconds >= 1 &&
        node.seconds <= 5
      )
    ) {
      errors.error('seconds', 'seconds is from 1 to 5');
    }
    return errors.issues;
  },

  expand(node): KitExpansion {
    const box = placementBox(node);
    const parts = parseParts(node);
    const tree =
      typeof node.circuit === 'string'
        ? parseCircuit(node.circuit)
        : ({
            kind: 'series',
            items: [...parts.keys()].map(id => ({kind: 'part', id})),
          } as Expr);
    const loop = tree.kind === 'series' ? tree.items : [tree];
    const [first, ...rest] = loop;
    // The source sits at the bottom, the rest across the top.
    const chainExpr: Expr =
      rest.length === 1 ? rest[0] : {kind: 'series', items: rest};
    const chain = layoutExpr(chainExpr, parts);
    const source = layoutExpr(first, parts);
    const on = chain.conducts && source.conducts;

    const side = 44;
    const left = -side;
    const right = chain.width + side;
    const sourceX = (chain.width - source.width) / 2;
    const bottom = chain.down + 60 + source.up - LABEL;
    const allParts: Placed[] = [
      ...chain.parts.map(p => ({...p, live: p.live && on})),
      ...source.parts.map(p => ({
        ...p,
        x: p.x + sourceX,
        y: p.y + bottom,
        live: p.live && on,
        labelBelow: true,
      })),
    ];
    const wires: Wire[] = [
      ...chain.wires.map(w => ({...w, live: w.live && on})),
      ...source.wires.map(w => ({
        live: w.live && on,
        points: w.points.map(
          ([x, y]) => [x + sourceX, y + bottom] as [number, number],
        ),
      })),
      // Round the loop in the direction current flows: out of the source's
      // first terminal (+ for a battery), across the top, back into the other.
      {
        points: [
          [sourceX, bottom],
          [left, bottom],
          [left, 0],
          [0, 0],
        ],
        live: on,
      },
      {
        points: [
          [chain.width, 0],
          [right, 0],
          [right, bottom],
          [sourceX + source.width, bottom],
        ],
        live: on,
      },
    ];
    const dots = [
      ...chain.dots,
      ...source.dots.map(
        ([x, y]) => [x + sourceX, y + bottom] as [number, number],
      ),
    ];

    // Fit the drawing into the box.
    const top = -chain.up;
    const floor = bottom + source.down + LABEL;
    const width = right - left + 40;
    const height = floor - top + 20;
    const s = Math.min(1.35, box.width / width, box.height / height);
    const ox = box.x - ((left + right) / 2) * s;
    const oy = box.y - ((top + floor) / 2) * s;
    const P = ([x, y]: [number, number]): [number, number] => [
      Math.round(ox + x * s),
      Math.round(oy + y * s),
    ];

    const id = node.id;
    const nodes: SceneNode[] = [];
    const touches: Touch[] = [];
    const kitParts = new Map<string, KitPart>();
    const ink = ICON_HEX.ink;
    const lineWidth = Math.max(2, Math.round(3 * s * 10) / 10);
    const wireIds: string[] = [];
    const flowIds: string[] = [];
    const glowIds: string[] = [];
    const symbolIds: string[] = [];

    // Wires first, so symbols and dots draw over their ends.
    wires.forEach((wire, k) => {
      const wireId = `${id}_w${k}`;
      nodes.push({
        id: wireId,
        component: 'Line',
        halo: 0,
        props: {
          points: wire.points.map(P),
          stroke: ink,
          lineWidth,
          lineJoin: 'round',
        },
      });
      wireIds.push(wireId);
    });
    // Glows behind the parts that light up.
    for (const placed of allParts) {
      if (!placed.part.icon.symbol?.glows || !placed.live) continue;
      const glowId = `${id}_${placed.part.id}Glow`;
      const at = P([placed.x, placed.y]);
      nodes.push({
        id: glowId,
        component: 'Circle',
        props: {
          size: Math.round(52 * s),
          fill: '#FFE27A',
          opacity: 0,
          position: at,
        },
      });
      glowIds.push(glowId);
    }
    for (const placed of allParts) {
      const at = P([placed.x, placed.y]);
      const drawn = drawIcon(`${id}_${placed.part.id}`, placed.part.icon, at, {
        size: SYMBOL * s,
        color: 'ink',
        style: 'line',
        stroke: lineWidth,
      });
      nodes.push(...drawn.nodes);
      touches.push(...drawn.touches);
      symbolIds.push(...drawn.ids);
      const labelId = `${id}_${placed.part.id}Label`;
      const half = symbolExtent(placed.part) * s;
      const labelY = placed.labelBelow
        ? at[1] + half + 22 * s
        : at[1] - half - 20 * s;
      const fontSize = Math.max(18, Math.round(24 * s));
      const tex = mixedTextToTex(placed.part.label);
      nodes.push(
        tex
          ? {
              id: labelId,
              component: 'Latex',
              props: {tex, fontSize, position: [at[0], Math.round(labelY)]},
            }
          : {
              id: labelId,
              component: 'Txt',
              props: {
                text: placed.part.label,
                fontSize,
                position: [at[0], Math.round(labelY)],
              },
            },
      );
      kitParts.set(placed.part.id, {
        nodes: [...drawn.ids, labelId],
        ...(drawn.strokeId ? {traceable: [drawn.strokeId]} : {}),
      });
      // A label names its part, a glow sits behind it.
      for (const part of drawn.ids) {
        touches.push({
          a: labelId,
          b: part,
          reason: 'the label names this part',
        });
      }
      if (glowIds.includes(`${id}_${placed.part.id}Glow`)) {
        touches.push({
          a: labelId,
          b: `${id}_${placed.part.id}Glow`,
          reason: 'the glow of the part it names',
        });
      }
    }
    dots.forEach((dot, k) => {
      const dotId = `${id}_j${k}`;
      nodes.push({
        id: dotId,
        component: 'Circle',
        halo: 0,
        props: {size: Math.round(10 * s), fill: ink, position: P(dot)},
      });
      symbolIds.push(dotId);
    });
    // The current: bright dashes over every live wire, running along it.
    const direction = node.current === 'electrons' ? 1 : -1;
    const seconds = typeof node.seconds === 'number' ? node.seconds : 3;
    const travel = Math.round(140 * seconds * s);
    wires.forEach((wire, k) => {
      if (!wire.live) return;
      const flowId = `${id}_f${k}`;
      nodes.push({
        id: flowId,
        component: 'Line',
        halo: 0,
        props: {
          points: wire.points.map(P),
          stroke: ICON_HEX.coral,
          lineWidth: Math.round(lineWidth * 1.6 * 10) / 10,
          lineDash: [Math.round(12 * s), Math.round(22 * s)],
          lineCap: 'round',
          lineJoin: 'round',
          opacity: 0,
        },
      });
      flowIds.push(flowId);
    });

    // Everything drawn is one connected diagram: wires meet symbols, dots
    // and each other, the current runs on the wires, glows sit behind lamps.
    const connected = [...wireIds, ...flowIds, ...glowIds, ...symbolIds];
    for (let a = 0; a < connected.length; a++) {
      for (let b = a + 1; b < connected.length; b++) {
        touches.push({
          a: connected[a],
          b: connected[b],
          reason: 'one connected circuit',
        });
      }
    }

    kitParts.set('wires', {nodes: wireIds, traceable: wireIds});
    if (flowIds.length) kitParts.set('current', {nodes: flowIds});
    const play: Step[] = flowIds.length
      ? [
          {
            kind: 'chain',
            steps: [
              {
                kind: 'all',
                steps: [
                  ...flowIds.map(f => ({
                    kind: 'tween' as const,
                    node: f,
                    prop: 'opacity',
                    to: 1,
                    seconds: 0.3,
                  })),
                  ...glowIds.map(g => ({
                    kind: 'tween' as const,
                    node: g,
                    prop: 'opacity',
                    to: 0.9,
                    seconds: 0.5,
                  })),
                ],
              },
              {
                kind: 'all',
                steps: flowIds.map(f => ({
                  kind: 'tween' as const,
                  node: f,
                  prop: 'lineDashOffset',
                  to: direction * travel,
                  seconds,
                  easing: 'linear',
                })),
              },
            ],
          },
        ]
      : // No complete loop: nothing flows. Hold, so the beat still has its moment.
        [{kind: 'wait', seconds: Math.min(1.5, seconds)}];
    kitParts.set('', {
      nodes: nodes.filter(n => n.props?.opacity !== 0).map(n => n.id),
      play,
    });
    return {nodes, touches, parts: kitParts};
  },
};
