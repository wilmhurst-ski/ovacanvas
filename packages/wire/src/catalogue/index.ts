import {GENERATED_CATALOGUE} from './generated.js';
import type {Catalogue, ComponentSpec, PortType, PropSpec} from './types.js';

export type * from './types.js';

/** The catalogue extracted from the installed engine declarations. */
export function getCatalogue(): Catalogue {
  return GENERATED_CATALOGUE;
}

export function getComponent(
  name: string,
  catalogue: Catalogue = GENERATED_CATALOGUE,
): ComponentSpec | undefined {
  return Object.prototype.hasOwnProperty.call(catalogue.components, name)
    ? catalogue.components[name]
    : undefined;
}

export function getProp(
  component: ComponentSpec,
  prop: string,
): PropSpec | undefined {
  return Object.prototype.hasOwnProperty.call(component.props, prop)
    ? component.props[prop]
    : undefined;
}

/** Whether `component` is, or extends, the engine class `family`. */
export function isA(component: ComponentSpec, family: string): boolean {
  return component.name === family || component.extends.includes(family);
}

/** Text components: the ones a typographic `role` applies to. */
export function isTextComponent(component: ComponentSpec): boolean {
  return isA(component, 'Txt') || isA(component, 'Latex');
}

function editDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const row = Array.from({length: y.length + 1}, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const current = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        previous + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[y.length];
}

/**
 * The closest real names to one that does not exist - the "did you mean"
 * that turns a hallucinated prop into a one-token fix.
 */
export function suggest(
  name: string,
  candidates: Iterable<string>,
  limit = 3,
): string[] {
  const lower = name.toLowerCase();
  return [...candidates]
    .map(candidate => {
      const c = candidate.toLowerCase();
      // Containment ("Rect" in "Rectangle", "size" in "fontSize") is a
      // stronger signal than spelling, as long as the shorter name is not a
      // trivially short fragment.
      const contained =
        Math.min(c.length, lower.length) >= 3 &&
        (c.includes(lower) || lower.includes(c));
      const distance = editDistance(name, candidate);
      return {
        candidate,
        contained,
        score: distance - (contained ? 2 : 0),
        distance,
      };
    })
    .filter(
      ({candidate, contained, distance}) =>
        contained ||
        distance <=
          Math.max(2, Math.floor(Math.max(candidate.length, name.length) / 3)),
    )
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map(({candidate}) => candidate);
}

/** Common mistakes whose fix is a different prop, not a spelling correction. */
const PROP_ALIASES: Readonly<Record<string, string>> = {
  color: 'fill',
  colour: 'fill',
  textColor: 'fill',
  background: 'fill',
  backgroundColor: 'fill',
  strokeColor: 'stroke',
  borderColor: 'stroke',
  strokeWidth: 'lineWidth',
  borderWidth: 'lineWidth',
  content: 'text',
  label: 'text',
  value: 'text',
  latex: 'tex',
  math: 'tex',
  equation: 'tex',
  pos: 'position',
  center: 'position',
  alpha: 'opacity',
  angle: 'rotation',
  cornerRadius: 'radius',
  r: 'size',
  diameter: 'size',
  font: 'fontFamily',
};

export function suggestProp(component: ComponentSpec, prop: string): string[] {
  const alias = PROP_ALIASES[prop];
  const names = Object.keys(component.props);
  const suggestions = suggest(prop, names);
  if (alias && names.includes(alias)) {
    return [alias, ...suggestions.filter(s => s !== alias)].slice(0, 3);
  }
  return suggestions;
}

/** A compact, model-readable description of a port type. */
export function formatType(
  type: PortType,
  catalogue: Catalogue = GENERATED_CATALOGUE,
): string {
  const nullable = type.nullable ? ' | null' : '';
  switch (type.kind) {
    case 'number':
    case 'string':
    case 'boolean':
      return type.kind + nullable;
    case 'color':
      return `color (CSS string like "#2F66D0", or {"theme": ${catalogue.themeColors.map(c => `"${c}"`).join('|')}})${nullable}`;
    case 'vector2':
      return `vector2 ([x, y], {"x", "y"} or one number)${nullable}`;
    case 'spacing':
      return `spacing (number or [top, right, bottom, left])${nullable}`;
    case 'length':
      return `length (pixels, or a percentage string like "50%")${nullable}`;
    case 'enum':
      return `${type.choices.map(c => `"${c}"`).join(' | ')}${nullable}`;
    case 'origin':
      return `origin (${catalogue.origins.map(o => `"${o}"`).join(' | ')})${nullable}`;
    case 'node':
      return `{"ref": "<node id>"}${type.component ? ` of a ${type.component}` : ''}${nullable}`;
    case 'endpoint':
      return `endpoint ([x, y], or {"ref": "<node id>", "side"?: "center|top|bottom|left|right|topLeft|topRight|bottomLeft|bottomRight"})${nullable}`;
    case 'points':
      return `points (list of 2+ endpoints: [x, y] or {"ref", "side"?})${nullable}`;
    case 'numbers':
      return `${type.length ? `${type.length} numbers` : 'number[]'}${nullable}`;
    case 'tex':
      return `LaTeX string (or list of LaTeX fragments)${nullable}`;
    case 'json':
      return `JSON matching the engine type ${type.tsType}${nullable}`;
  }
}

export interface ComponentDescription {
  readonly name: string;
  readonly summary?: string;
  readonly role: 'item' | 'route';
  readonly extends: readonly string[];
  readonly props: Readonly<
    Record<
      string,
      {
        type: string;
        required?: true;
        tweenable?: true;
        default?: string;
        doc?: string;
      }
    >
  >;
  /** Names of the non-essential props, available on request. */
  readonly advancedProps?: readonly string[];
}

/**
 * Describe one component for a model: essential props in full, everything
 * else by name only, so the default description stays small.
 */
export function describeComponent(
  component: ComponentSpec,
  options: {all?: boolean; catalogue?: Catalogue} = {},
): ComponentDescription {
  const catalogue = options.catalogue ?? GENERATED_CATALOGUE;
  const props: Record<string, ComponentDescription['props'][string]> = {};
  const advanced: string[] = [];
  for (const [name, spec] of Object.entries(component.props)) {
    if (!options.all && !spec.essential && !spec.required) {
      advanced.push(name);
      continue;
    }
    props[name] = {
      type: formatType(spec.type, catalogue),
      ...(spec.required ? {required: true as const} : {}),
      ...(spec.tweenable && isTweenableKind(spec.type)
        ? {tweenable: true as const}
        : {}),
      ...(spec.default !== undefined ? {default: spec.default} : {}),
      ...(spec.doc ? {doc: spec.doc} : {}),
    };
  }
  return {
    name: component.name,
    ...(component.summary ? {summary: component.summary} : {}),
    role: component.role,
    extends: component.extends,
    props,
    ...(advanced.length ? {advancedProps: advanced} : {}),
  };
}

/**
 * Kinds whose values the engine can interpolate. A boolean or a node
 * reference has a signal too, but "tweening" it would just snap.
 */
/**
 * JSON-typed props made only of numbers (and fixed strings), which the
 * engine's deepLerp interpolates field by field: a camera moving, a globe
 * turning, a 3D point sliding. Other JSON props (a world, a feature) would
 * snap or break, so they stay instant.
 */
const TWEENABLE_JSON = new Set([
  'Camera3DSpec',
  'GeoProjectionSpec',
  'Vec3Like',
]);

export function isTweenableKind(type: PortType): boolean {
  if (type.kind === 'json') return TWEENABLE_JSON.has(type.tsType ?? '');
  return (
    type.kind === 'number' ||
    type.kind === 'color' ||
    type.kind === 'vector2' ||
    type.kind === 'spacing' ||
    type.kind === 'length' ||
    type.kind === 'string' ||
    type.kind === 'tex' ||
    type.kind === 'points' ||
    type.kind === 'endpoint'
  );
}

/** A one-line-per-component index, for listing tools and prompts. */
export function listComponents(
  catalogue: Catalogue = GENERATED_CATALOGUE,
): {name: string; role: 'item' | 'route'; summary?: string; extends: string}[] {
  return Object.values(catalogue.components).map(component => ({
    name: component.name,
    role: component.role,
    extends: component.extends[0] ?? '',
    ...(component.summary ? {summary: component.summary} : {}),
  }));
}
