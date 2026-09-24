import type {SceneNode, Touch, Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import {ICON_STYLES, drawIcon, type IconStyle} from '../icons/draw.js';
import {resolveIcon, suggestIcons, type IconDef} from '../icons/library.js';
import {measureText} from '../measure/text.js';
import {
  ACCENTS,
  FieldErrors,
  PLACEMENT_FIELDS,
  checkPlacement,
  isNumberPair,
  mixedTextToTex,
  placementBox,
  wrapText,
} from './fields.js';
import type {Box, KitExpansion, KitNode, KitPart, KitSpec} from './types.js';

/** Check an icon name, with the closest real names when it is unknown. */
export function checkIconName(
  errors: FieldErrors,
  field: string,
  name: Value | undefined,
  preferSymbols = false,
): void {
  if (typeof name !== 'string' || !name.trim()) {
    errors.error(
      field,
      'an icon is named in words: "house", "database", "thunder"',
    );
    return;
  }
  if (!resolveIcon(name, {preferSymbols})) {
    const close = suggestIcons(name);
    errors.error(
      field,
      `no icon for "${name}"`,
      close.length
        ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}? Or describe it in one or two plain words`
        : 'describe it in one or two plain words ("rain cloud", "water drop")',
    );
  }
}

function checkStyle(errors: FieldErrors, value: Value | undefined): void {
  if (
    value !== undefined &&
    !(ICON_STYLES as readonly Value[]).includes(value)
  ) {
    errors.error('style', `style is one of ${ICON_STYLES.join(', ')}`);
  }
}

/** A text label: words as Txt, words with maths in them typeset. */
function labelNode(
  id: string,
  text: string,
  at: [number, number],
  size: number,
  width: number,
  options: {secondary?: boolean; hidden?: boolean} = {},
): {nodes: SceneNode[]; height: number} {
  const tex = mixedTextToTex(text);
  const fill = options.secondary ? {theme: 'secondaryInk'} : {theme: 'ink'};
  const hidden: Record<string, Value> = options.hidden ? {opacity: 0} : {};
  if (tex) {
    return {
      nodes: [
        {
          id,
          component: 'Latex',
          props: {tex, fontSize: size, fill, position: at, ...hidden},
        },
      ],
      height: size * 1.4,
    };
  }
  const lines = wrapText(text, size, width);
  const lineHeight = size * 1.3;
  return {
    nodes: lines.map((line, k) => ({
      id: lines.length === 1 ? id : `${id}${k}`,
      component: 'Txt',
      props: {
        text: line,
        fontSize: size,
        ...(options.secondary ? {fill} : {}),
        position: [at[0], Math.round(at[1] + k * lineHeight)],
        ...hidden,
      },
    })),
    height: lines.length * lineHeight,
  };
}

const SINGLE_FIELDS = [
  'name',
  'label',
  'color',
  'style',
  'size',
  'at',
  ...PLACEMENT_FIELDS,
];

export const icon: KitSpec = {
  name: 'icon',
  summary:
    'One icon, named in plain words - "house", "database", "thunder", "solar panel", "resistor symbol" - from 1,800+ icons and schematic symbols, optionally labelled. Trace draws it on.',
  fields: {
    name: {
      type: 'words',
      required: true,
      doc: 'What it shows: "house", "db", "lightning", "hospital". Add "symbol" for a schematic drawing ("battery symbol").',
    },
    label: {type: 'string', doc: 'Words under the icon.'},
    color: {
      type: 'theme colour name or CSS colour',
      doc: 'Default blue (ink for line style).',
    },
    style: {
      type: '"badge" | "tile" | "line"',
      doc: 'On a soft disc (default), a rounded square, or the drawing alone.',
    },
    size: {type: 'number', doc: 'Pixels across (default 120).'},
    at: {
      type: '[x, y]',
      doc: 'The centre, on the stage (default the middle of the region).',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where it goes.',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box.',
    },
  },
  parts: '"<id>.icon" (trace draws it), "<id>.label"',
  example: {
    id: 'power',
    kit: 'icon',
    name: 'thunder',
    label: 'Electricity',
    color: 'yellow',
  },

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(SINGLE_FIELDS);
    checkPlacement(node, errors);
    checkIconName(errors, 'name', node.name);
    checkStyle(errors, node.style);
    if (node.label !== undefined && typeof node.label !== 'string') {
      errors.error('label', 'label is words');
    }
    if (node.at !== undefined && !isNumberPair(node.at)) {
      errors.error('at', 'at is [x, y] on the stage');
    }
    if (
      node.size !== undefined &&
      !(typeof node.size === 'number' && node.size >= 24 && node.size <= 400)
    ) {
      errors.error('size', 'size is from 24 to 400 pixels');
    }
    return errors.issues;
  },

  expand(node): KitExpansion {
    const box = placementBox(node);
    const def = resolveIcon(String(node.name))!;
    const size = typeof node.size === 'number' ? node.size : 120;
    const style = (node.style as IconStyle | undefined) ?? 'badge';
    const label = typeof node.label === 'string' ? node.label : '';
    const labelSpace = label ? 60 : 0;
    const at: [number, number] = isNumberPair(node.at)
      ? [node.at[0], node.at[1]]
      : [box.x, box.y - labelSpace / 2];
    const drawn = drawIcon(node.id, def, at, {
      size,
      style,
      color: typeof node.color === 'string' ? node.color : undefined,
    });
    const nodes = [...drawn.nodes];
    const parts = new Map<string, KitPart>();
    parts.set('icon', {
      nodes: drawn.ids,
      ...(drawn.strokeId ? {traceable: [drawn.strokeId]} : {}),
    });
    if (label) {
      const text = labelNode(
        `${node.id}Label`,
        label,
        [Math.round(at[0]), Math.round(at[1] + drawn.radius + 34)],
        30,
        Math.max(260, drawn.radius * 4),
      );
      nodes.push(...text.nodes);
      parts.set('label', {nodes: text.nodes.map(n => n.id)});
    }
    parts.set('', {nodes: nodes.map(n => n.id)});
    return {nodes, touches: drawn.touches, parts};
  },
};

// ---- a set of icons ------------------------------------------------------------

interface Item {
  name: string;
  label?: string;
  detail?: string;
  color?: string;
}

function parseItems(node: KitNode, errors?: FieldErrors): Item[] {
  if (!Array.isArray(node.items) || !node.items.length) {
    errors?.error(
      'items',
      'items is a list: ["house", {"icon": "zap", "label": "Power"}]',
    );
    return [];
  }
  return node.items.map((raw, i) => {
    if (typeof raw === 'string') return {name: raw};
    if (isObject(raw) && typeof raw.icon === 'string') {
      for (const key of Object.keys(raw)) {
        if (!['icon', 'label', 'detail', 'color'].includes(key)) {
          errors?.error(
            'items',
            `items[${i}] has no field "${key}"`,
            'an item is {"icon", "label"?, "detail"?, "color"?}',
          );
        }
      }
      return {
        name: raw.icon,
        ...(typeof raw.label === 'string' ? {label: raw.label} : {}),
        ...(typeof raw.detail === 'string' ? {detail: raw.detail} : {}),
        ...(typeof raw.color === 'string' ? {color: raw.color} : {}),
      };
    }
    errors?.error(
      'items',
      `items[${i}] is an icon name or {"icon": "...", "label": "..."}`,
    );
    return {name: ''};
  });
}

const LAYOUTS = ['row', 'grid', 'flow', 'cycle'] as const;
type Layout = (typeof LAYOUTS)[number];

function positions(
  layout: Layout,
  n: number,
  box: Box,
  cell: number,
): [number, number][] {
  if (layout === 'cycle') {
    const rx = box.width / 2 - cell * 0.75;
    const ry = box.height / 2 - cell * 0.8;
    return Array.from({length: n}, (_, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return [box.x + rx * Math.cos(a), box.y + ry * Math.sin(a) - 20] as [
        number,
        number,
      ];
    });
  }
  if (layout === 'grid') {
    const columns = Math.min(4, Math.ceil(Math.sqrt(n)));
    const rows = Math.ceil(n / columns);
    return Array.from({length: n}, (_, i) => {
      const r = Math.floor(i / columns);
      const inRow = Math.min(columns, n - r * columns);
      const c = i % columns;
      return [
        box.x + (c - (inRow - 1) / 2) * (box.width / columns),
        box.y + (r - (rows - 1) / 2) * (box.height / rows) - 30,
      ] as [number, number];
    });
  }
  return Array.from(
    {length: n},
    (_, i) =>
      [box.x + (i - (n - 1) / 2) * (box.width / n), box.y - 40] as [
        number,
        number,
      ],
  );
}

export const icons: KitSpec = {
  name: 'icons',
  summary:
    'A set of icons with labels: a row of ideas, a grid of examples, a flow from one thing to the next, or a cycle. Icons are named in plain words.',
  fields: {
    items: {
      type: '["house", {"icon": "zap", "label": "Power", "detail"?: "...", "color"?: "..."}]',
      required: true,
      doc: 'The icons, in order.',
    },
    layout: {
      type: '"row" | "grid" | "flow" | "cycle"',
      doc: 'Side by side (default), in a grid, left to right with arrows, or round in a ring with arrows.',
    },
    style: {
      type: '"badge" | "tile" | "line"',
      doc: 'How each icon is drawn (default badge).',
    },
    color: {
      type: 'theme colour name or CSS colour',
      doc: 'One colour for all; by default each item gets its own accent.',
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
    '"<id>.0", "<id>.1", ... one item (icon and words); "<id>.0->1" an arrow (flow and cycle)',
  example: {
    id: 'grid',
    kit: 'icons',
    layout: 'flow',
    items: [
      {icon: 'power plant', label: 'Power station'},
      {icon: 'thunder', label: 'Grid'},
      {icon: 'house', label: 'Home'},
    ],
  },

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields([
      'items',
      'layout',
      'style',
      'color',
      ...PLACEMENT_FIELDS,
    ]);
    checkPlacement(node, errors);
    parseItems(node, errors).forEach((item, i) => {
      if (item.name) checkIconName(errors, `items.${i}`, item.name);
    });
    checkStyle(errors, node.style);
    if (
      node.layout !== undefined &&
      !(LAYOUTS as readonly Value[]).includes(node.layout)
    ) {
      errors.error('layout', `layout is one of ${LAYOUTS.join(', ')}`);
    }
    if (Array.isArray(node.items) && node.items.length > 12) {
      errors.error('items', 'at most 12 icons in one set');
    }
    return errors.issues;
  },

  expand(node): KitExpansion {
    const box = placementBox(node);
    const items = parseItems(node);
    const layout = (node.layout as Layout | undefined) ?? 'row';
    const style = (node.style as IconStyle | undefined) ?? 'badge';
    const n = items.length;
    const columns =
      layout === 'grid'
        ? Math.min(4, Math.ceil(Math.sqrt(n)))
        : layout === 'cycle'
          ? Math.max(3, Math.ceil(n / 2))
          : n;
    const rows =
      layout === 'grid' ? Math.ceil(n / columns) : layout === 'cycle' ? 2.4 : 1;
    const cellWidth = box.width / columns;
    const cellHeight = box.height / rows;
    // The drawn extent (a badge is 1.7x the icon) fits the cell with room for words.
    const factor = style === 'line' ? 1 : 1.7;
    const size = Math.round(
      Math.max(
        40,
        Math.min(150, (cellWidth * 0.55) / factor, (cellHeight * 0.5) / factor),
      ),
    );
    // Words wrap between words, never inside one: the longest word must fit
    // its cell, so the type shrinks until it does.
    // Cell width less the audit halo on both neighbours and a little air.
    const labelWidth = cellWidth - 40;
    // The widest word at a font size of 1, measured in the engine's font.
    const longest = Math.max(
      0.3,
      ...items.flatMap(item =>
        `${item.label ?? ''} ${item.detail ?? ''}`
          .split(/\s+/)
          .filter(Boolean)
          .map(w => measureText(w, 1) + 0.2),
      ),
    );
    const labelSize = Math.round(
      Math.max(14, Math.min(30, size * 0.26, labelWidth / longest)),
    );
    const at = positions(layout, n, box, size * factor);
    const nodes: SceneNode[] = [];
    const touches: Touch[] = [];
    const parts = new Map<string, KitPart>();
    const radii: number[] = [];
    items.forEach((item, i) => {
      const def: IconDef = resolveIcon(item.name)!;
      const drawn = drawIcon(`${node.id}${i}`, def, at[i], {
        size,
        style,
        color:
          item.color ??
          (typeof node.color === 'string'
            ? node.color
            : style === 'line'
              ? undefined
              : ACCENTS[i % ACCENTS.length]),
      });
      radii.push(drawn.radius);
      nodes.push(...drawn.nodes);
      touches.push(...drawn.touches);
      const partNodes = [...drawn.ids];
      // Clear of the icon by both audit halos, not a fraction of the type.
      let y = at[i][1] + drawn.radius + 20 + labelSize * 0.65;
      const width = labelWidth;
      if (item.label) {
        const text = labelNode(
          `${node.id}${i}Label`,
          item.label,
          [Math.round(at[i][0]), Math.round(y)],
          labelSize,
          width,
        );
        nodes.push(...text.nodes);
        partNodes.push(...text.nodes.map(t => t.id));
        y += text.height;
      }
      if (item.detail) {
        const text = labelNode(
          `${node.id}${i}Detail`,
          item.detail,
          [Math.round(at[i][0]), Math.round(y)],
          Math.round(labelSize * 0.78),
          width,
          {secondary: true},
        );
        nodes.push(...text.nodes);
        partNodes.push(...text.nodes.map(t => t.id));
      }
      // One item's words belong to it.
      const words = partNodes.slice(drawn.ids.length);
      for (let a = 0; a < words.length; a++) {
        for (let b = a + 1; b < words.length; b++) {
          touches.push({
            a: words[a],
            b: words[b],
            reason: 'lines of one caption',
          });
        }
      }
      parts.set(String(i), {
        nodes: partNodes,
        ...(drawn.strokeId ? {traceable: [drawn.strokeId]} : {}),
      });
    });

    // Arrows from each item to the next.
    if (layout === 'flow' || layout === 'cycle') {
      const count = layout === 'cycle' ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % n;
        const [x1, y1] = at[i];
        const [x2, y2] = at[j];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy) || 1;
        const gapA = radii[i] + 18;
        const gapB = radii[j] + 18;
        if (length <= gapA + gapB + 20) continue;
        const arrowId = `${node.id}Arrow${i}`;
        nodes.push({
          id: arrowId,
          component: 'Line',
          props: {
            points: [
              [
                Math.round(x1 + (dx / length) * gapA),
                Math.round(y1 + (dy / length) * gapA),
              ],
              [
                Math.round(x2 - (dx / length) * gapB),
                Math.round(y2 - (dy / length) * gapB),
              ],
            ],
            stroke: {theme: 'secondaryInk'},
            lineWidth: 4,
            endArrow: true,
            arrowSize: 14,
          },
        });
        parts.set(`${i}->${j}`, {nodes: [arrowId], traceable: [arrowId]});
      }
    }
    parts.set('', {nodes: nodes.map(x => x.id)});
    return {nodes, touches, parts};
  },
};
