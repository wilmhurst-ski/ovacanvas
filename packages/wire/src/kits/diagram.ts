import type {Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import {drawDiagram, type DiagramSpec} from '../diagram/draw.js';
import {
  PART_KEYS,
  SHAPE_KEYS,
  VECTOR_KEYS,
  resolveDiagram,
  shapeKeyOf,
  type RawPart,
  type Template,
} from '../diagram/resolve.js';
import {
  FieldErrors,
  PLACEMENT_FIELDS,
  checkPlacement,
  placementBox,
} from './fields.js';
import {PARAMS_FIELD, readParams} from './params.js';
import type {KitNode, KitSpec} from './types.js';

/**
 * Diagram: any picture made of parts placed in relation to each other.
 *
 * @remarks
 * The general kit under the special ones. A part is one thing - a box, a
 * circle, a ring, a line, an arrow, a ray, a polygon, a dot, words, an
 * icon, or a row / column / grid / set of items - placed by coordinates or,
 * better, by relation: on a slope, around a nucleus, below cell 3, inside
 * a container, the component of a force down a slope, where two rays
 * meet. Atoms and solar systems, arrays and stacks, forces on a ramp, rays
 * through a lens, cells and lattices are all the same few ideas; nothing
 * here knows about any one subject.
 */

const FIELDS = ['parts', 'define', 'params', ...PLACEMENT_FIELDS];
const PART_NAME = /^[A-Za-z][A-Za-z0-9]{0,10}$/;
const GROUP_KEYS = new Set(['row', 'column', 'grid', 'items']);

/** The templates an instance defines, by name: their parts and params. */
function readTemplates(
  node: KitNode,
  errors?: FieldErrors,
): Record<string, Template> {
  const out: Record<string, Template> = {};
  if (node.define === undefined) return out;
  if (!isObject(node.define)) {
    errors?.error('define', 'define is {"<name>": {"parts": {...}, "params"?: {...}}}');
    return out;
  }
  for (const [name, raw] of Object.entries(node.define)) {
    if (!PART_NAME.test(name)) {
      errors?.error('define', `template name "${name}" must be letters and digits`);
      continue;
    }
    if (!isObject(raw)) {
      errors?.error('define', `template "${name}" is {"parts": {...}}`);
      continue;
    }
    // {"parts": {...}, "params": {...}}, or the parts alone.
    const parts = isObject(raw.parts) ? raw.parts : raw;
    const extra = isObject(raw.parts)
      ? Object.keys(raw).filter(k => k !== 'parts' && k !== 'params')
      : [];
    if (extra.length) {
      errors?.error('define', `template "${name}" has unknown key(s) ${extra.join(', ')}`, 'a template is {"parts", "params"?}');
    }
    out[name] = {
      parts: parts as Record<string, RawPart>,
      params: readParams(isObject(raw.parts) ? raw.params : undefined, errors),
    };
  }
  return out;
}

function readSpec(node: KitNode): DiagramSpec {
  return {
    parts: (isObject(node.parts) ? node.parts : {}) as Record<string, RawPart>,
    params: readParams(node.params),
    templates: readTemplates(node),
  };
}

/** A group's item values, flattened, as identity keys. */
function groupValues(part: RawPart): string[] | null {
  const key = shapeKeyOf(part);
  if (!key || !GROUP_KEYS.has(key)) return null;
  const value = part[key];
  if (!Array.isArray(value)) return null;
  const flat = key === 'grid' ? (value as Value[]).flat() : value;
  return (flat as Value[]).map(v =>
    isObject(v) ? JSON.stringify(v.tex ?? v.text ?? v) : JSON.stringify(v),
  );
}

/**
 * Which item is which in each version: an item keeps its identity while
 * its value does (a sort moves the 5 rather than rewriting two cells).
 */
function identitiesFor(
  specs: readonly DiagramSpec[],
): Map<string, number[]>[] {
  const out: Map<string, number[]>[] = [];
  let previous = new Map<string, {values: string[]; ids: number[]; next: number}>();
  for (const spec of specs) {
    const map = new Map<string, number[]>();
    const now = new Map<string, {values: string[]; ids: number[]; next: number}>();
    for (const [name, part] of Object.entries(spec.parts)) {
      const values = isObject(part) ? groupValues(part) : null;
      if (!values) continue;
      const before = previous.get(name);
      let ids: number[];
      let next: number;
      if (!before) {
        ids = values.map((_, i) => i);
        next = values.length;
      } else {
        next = before.next;
        const pool = new Map<string, number[]>();
        before.values.forEach((v, i) => {
          pool.set(v, [...(pool.get(v) ?? []), before.ids[i]]);
        });
        ids = values.map(v => {
          const queue = pool.get(v);
          return queue && queue.length ? queue.shift()! : next++;
        });
      }
      map.set(name, ids);
      now.set(name, {values, ids, next});
    }
    out.push(map);
    previous = now;
  }
  return out;
}

export const diagram: KitSpec = {
  name: 'diagram',
  summary:
    'Any picture made of parts placed by relation instead of coordinates: forces on a body, rays through a lens, atoms and orbits, arrays and pointers, stacks and lists, cells, lattices, containers. Each part is one thing (a shape, line, arrow, ray, words, icon, or a row/column/grid/set of items) placed "on", "inside", "above/below/left/right" of another part, or at coordinates; arrows can be vectors ("dir": "down slope") or components of other vectors; points can be constructions ({"meet": ["ray1", "ray2"]}). Units are yours (y down); the drawing is scaled to fit and labels are placed for you.',
  fields: {
    parts: {
      type: '{"<name>": part, ...}',
      required: true,
      doc: [
        'The parts, drawn in order. A part has ONE of: "box": [w, h] | true (fits its text); "circle": r; "ring": r (an outline: orbit, shell); "ellipse": [w, h]; "dot": true; "polygon": [[x, y], ...] | n sides (with "size"); "line" / "arrow": [p, q, ...] (between parts it runs edge to edge); "ray": [p, q, ...] (runs on past the last point to the edge); "text": "words"; "tex": "maths"; "icon": "name"; "row" / "column": [values]; "grid": [[values], ...]; "items": n | [values].',
        'A point p is [x, y] (numbers or expressions in params and other parts\' coordinates, e.g. ["lens.x", "tip.y"]), a part name ("F", "block", "cells.3" = item 3) with an optional point of it (".top", ".bottom", ".left", ".right", ".center", corners like ".topleft", or a line\'s ".start", ".end", ".mid"), or a construction: {"meet": [lineA, lineB]}, {"mid": [p, q]}, {"foot": [p, line]}, {"mirror": [p, line]}.',
        'Where it goes (one of): "at": p; "on": part - on a line or the top edge of a polygon/box it SITS on it, turned with it ("t": 0-1 along, "side": "below" to hang under); on a ring/circle it RIDES on it ("angle": degrees, 90 = top); "inside": part; "above"/"below"/"left"/"right": part ("gap"). Then "offset": [dx, dy], "turn": degrees.',
        'Arrow as a vector: {"from": p, "dir": d, "length": n}; d is degrees (0 = right, 90 = up), "up"/"down"/"left"/"right", "up <line>"/"down <line>" (along it, uphill/downhill), "along"/"against <line>", "out <surface>"/"into <surface>" (perpendicular), "toward <part>". A component: {"from": p, "component": "<vector part>", "dir": d} - its length is worked out. A pointer: {"to": part, "from": "below"|"above"|"left"|"right"}. Round a ring or circle: {"along": "wheel", "from": 150, "to": 30} (degrees; counter-clockwise when "to" is larger) - spin, orbits, circular motion. Any line or arrow can "bend": 0.3 (bows left of its direction; negative bows right; between parts it still runs edge to edge) or be "smooth": true (a smooth curve through its points, e.g. a rope or a flow path).',
        'Items: "row": [2, 5, 8] draws touching cells holding the values (an array); "column" stacks them; "grid" a table; "items": 6 with "on": "<ring>" spreads six dots round it (electrons, planets) or along a line; "arrange": "row"|"column"|"grid"|"around"|"scatter" ("inside": part scatters them in it); "shape": "box"|"circle"|"ring"|"dot"|"none" for each item; "size", "gap", "cols", "radius", "index": true (index numbers under cells). An item is a value or {"text"|"tex", "color", "label"}. Beats address items as "<id>.<part>.3" or ranges "<id>.<part>.2-5"; set a new list of values and the items move to their new places (a sort, a swap).',
        'Also on any part: "text"/"tex" (written inside a shape), "label" (placed beside it for you), "color", "outline": true (unfilled), "dashed": true, "width" (line px), "fontSize", "back": true (a ray\'s dashed backward extension, for virtual images).',
        'Something drawn many times (an atom, a molecule, a planet with its moon, a cell): "define" it once, then place it with "use": {"use": "water", "at": [2, 0], "turn": 30, "scale": 1.5, "with": {"<param>": value}}, or make items of it: {"items": 12, "use": "water", "arrange": "grid"}. Its parts are "<part>.<its part>" ("a.electron", "mols.3.O").',
      ].join(' '),
    },
    define: {
      type: '{"<name>": {"parts": {...}, "params"?: {"k": 1}}}',
      doc: 'Templates: a small drawing (in its own units, around its own middle) placed with "use". Its numbers may be expressions in its params, which "with" sets per copy - and a beat can set them: {"set": {"<id>.a.with.k": 3}}.',
    },
    params: PARAMS_FIELD,
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where the diagram goes (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box instead of a region.',
    },
  },
  parts:
    '"<id>.<part>" any part (its shape, text and label); "<id>.<part>.<i>" one item, "<id>.<part>.2-5" several; lines, arrows, rays, rings and polygons can be traced; set any part field: {"set": {"<id>.<part>.t": 0.8}} slides it along, {"set": {"<id>.cells.row": [3, 5, 8]}} reorders items',
  // Force names are capital letters, as in physics.
  /* eslint-disable @typescript-eslint/naming-convention */
  example: {
    id: 'ramp',
    kit: 'diagram',
    parts: {
      slope: {polygon: [[0, 0], [6, 0], [6, -3]], color: 'secondaryInk'},
      block: {box: [1.4, 0.9], on: 'slope', t: 0.55, color: 'yellow', text: 'm'},
      W: {arrow: {from: 'block', dir: 'down', length: 2.2}, label: 'mg', color: 'coral'},
      N: {arrow: {from: 'block', dir: 'out slope', length: 1.9}, label: 'N', color: 'blue'},
      along: {arrow: {from: 'block', component: 'W', dir: 'down slope'}, label: 'mg\\sin\\theta', color: 'green', dashed: true},
    },
  },
  /* eslint-enable @typescript-eslint/naming-convention */

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(FIELDS);
    checkPlacement(node, errors);
    const params = readParams(node.params, errors);
    const templates = readTemplates(node, errors);
    if (!isObject(node.parts) || !Object.keys(node.parts).length) {
      errors.error(
        'parts',
        'parts is {"<name>": part, ...}',
        'e.g. {"sun": {"circle": 1, "color": "yellow"}, "orbit": {"ring": 3}, "earth": {"circle": 0.3, "on": "orbit"}}',
      );
      return errors.issues;
    }
    let shapesOk = true;
    const allParts = [
      ...Object.entries(node.parts).map(([n, r]) => [`parts.${n}`, n, r] as const),
      ...Object.entries(templates).flatMap(([t, tpl]) =>
        Object.entries(tpl.parts).map(([n, r]) => [`define.${t}.${n}`, n, r as Value] as const),
      ),
    ];
    for (const [where, name, raw] of allParts) {
      if (!PART_NAME.test(name)) {
        errors.error(where, `part name "${name}" must be letters and digits (at most 11), starting with a letter`);
      }
      if (!isObject(raw)) {
        errors.error(where, `part "${name}" is an object, e.g. {"circle": 1}`);
        shapesOk = false;
        continue;
      }
      const unknown = Object.keys(raw).filter(k => !PART_KEYS.includes(k));
      for (const key of unknown) {
        const close = PART_KEYS.filter(
          k => k.toLowerCase() === key.toLowerCase() || k.startsWith(key.slice(0, 3)),
        );
        errors.error(
          `${where}.${key}`,
          `a part has no key "${key}"`,
          close.length ? `did you mean "${close[0]}"?` : `shapes: ${SHAPE_KEYS.join(', ')}`,
        );
      }
      const drawn = SHAPE_KEYS.filter(
        k => raw[k] !== undefined && k !== 'text' && k !== 'tex',
      );
      if (raw.use !== undefined && drawn.some(d => !GROUP_KEYS.has(d))) {
        errors.error(
          where,
          `part "${name}" is both a template ("use") and "${drawn[0]}" - a part is one thing`,
        );
        shapesOk = false;
      }
      const vectorKeys = VECTOR_KEYS.filter(k => raw[k] !== undefined);
      if (vectorKeys.length && !drawn.some(d => d === 'arrow' || d === 'line')) {
        errors.error(
          `${where}.${vectorKeys[0]}`,
          `"${vectorKeys[0]}" belongs to an arrow or line`,
          'e.g. {"arrow": {"from": "block", "dir": "down", "length": 2}}',
        );
        shapesOk = false;
      }
      if (drawn.length > 1) {
        errors.error(
          where,
          `part "${name}" is both ${drawn.map(d => `"${d}"`).join(' and ')} - a part is one thing`,
          'make a separate part for each thing, and place one relative to the other',
        );
        shapesOk = false;
      }
      if (unknown.length) shapesOk = false;
    }
    if (!shapesOk || errors.issues.length) return errors.issues;
    const seen = new Set<string>();
    resolveDiagram({
      parts: node.parts as Record<string, RawPart>,
      params,
      templates,
      scale: 100,
      font: 1,
      report: (prop, message, hint) => {
        const key = `${prop}|${message}`;
        if (seen.has(key)) return;
        seen.add(key);
        errors.error(prop, message, hint);
      },
    });
    return errors.issues;
  },

  expand(node, context) {
    const variantNodes = context.variants ?? [node];
    const specs = variantNodes.map(readSpec);
    const identities = identitiesFor(specs);
    // This version among all of them: the same object, or (over a whole
    // lesson, where each scene has its own copies) the same fields.
    let index = variantNodes.indexOf(node);
    if (index === -1) {
      const own = JSON.stringify(node);
      index = variantNodes.findIndex(v => JSON.stringify(v) === own);
    }
    let current = specs[index] ?? readSpec(node);
    let identity = identities[index];
    if (index === -1) {
      // A frame in between two versions (a set being sampled): drawn in the
      // frame of the versions, with the items of one with the same values.
      current = readSpec(node);
      const values = JSON.stringify(
        Object.values(current.parts).map(p => (isObject(p) ? groupValues(p) : null)),
      );
      index = specs.findIndex(
        s =>
          JSON.stringify(
            Object.values(s.parts).map(p => (isObject(p) ? groupValues(p) : null)),
          ) === values,
      );
      identity = index === -1 ? new Map() : identities[index];
    }
    return drawDiagram({
      id: node.id,
      box: placementBox(node),
      variants: specs,
      identities,
      current,
      identity,
      cacheKey: variantNodes,
      highlights: context.highlighted.size > 0,
    });
  },

  setPath(node, path) {
    const parts = isObject(node.parts) ? node.parts : {};
    return path[0] in parts && !(path[0] in diagram.fields)
      ? ['parts', ...path]
      : path;
  },

  interpolates(a, b) {
    // Items are identities, not numbers: a list set to new values moves
    // them; it is never blended through in-between values.
    const pa = isObject(a.parts) ? a.parts : {};
    const pb = isObject(b.parts) ? b.parts : {};
    for (const name of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
      const va = isObject(pa[name]) ? groupValues(pa[name] as RawPart) : null;
      const vb = isObject(pb[name]) ? groupValues(pb[name] as RawPart) : null;
      if (JSON.stringify(va) !== JSON.stringify(vb)) return false;
    }
    return true;
  },
};
