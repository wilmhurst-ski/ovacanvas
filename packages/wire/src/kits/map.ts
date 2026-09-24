import chroma from 'chroma-js';
import {
  geoCentroid,
  geoInterpolate,
  geoMercator,
  geoNaturalEarth1,
  geoOrthographic,
  type GeoProjection,
} from 'd3-geo';
import type {SceneNode, Touch, Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import {
  ACCENTS,
  FieldErrors,
  PLACEMENT_FIELDS,
  checkPlacement,
  isNumberPair,
  placementBox,
  textBox,
} from './fields.js';
import {
  GROUP_NAMES,
  countryGeo,
  largestPolygon,
  mainPolygons,
  mergedGeo,
  resolveCity,
  resolveCountry,
  resolveGroup,
  suggestCity,
  suggestCountry,
} from './geo/atlas.js';
import type {Box, KitExpansion, KitPart, KitSpec} from './types.js';

type Vec = [number, number];
type LonLat = [number, number];

/** The default theme's hex values, for tints the theme has no token for. */
const THEME_HEX: Readonly<Record<string, string>> = {
  blue: '#2F66D0',
  cyan: '#2EAEDC',
  coral: '#F05A3C',
  yellow: '#F3C742',
  green: '#4E9B62',
  magenta: '#B968A7',
  ink: '#151922',
};
const OCEAN = '#D5E5EE';
const LAND = '#E8E3D6';
const BORDER = '#FFFFFF';
const GRATICULE = '#BFD2DD';
const LABEL_SIZE = 26;
const MARKER_LABEL_SIZE = 23;
const HALO = '#FFFDFC';

function hexOf(color: string): string {
  return (
    THEME_HEX[color] ??
    (chroma.valid(color) ? chroma(color).hex() : THEME_HEX.blue)
  );
}

/** A fill light enough that ink labels stay readable on it. */
function tint(color: string): string {
  return chroma.mix(hexOf(color), '#FFFFFF', 0.4, 'rgb').hex();
}

/**
 * A place label's width as the audit sees it (map labels are drawn at
 * weight 600), with a few pixels of air.
 */
function labelWidth(text: string, size: number): number {
  return textBox(text, size, 600).width + 4;
}

/** A lower-camel id fragment from any name ("Côte d'Ivoire" to "coteDIvoire"). */
function slug(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const joined = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
  return joined || 'x';
}

/** Something shaded on the map: one country, a named group, or a region. */
interface Area {
  /** The name the author wrote - the part name and the label. */
  readonly name: string;
  readonly countries: readonly string[];
  /** One merged outline (a region) rather than a single country. */
  readonly merged: boolean;
  readonly color: string;
  /** Drawn at the start (listed in the kit), or only once a beat shows it. */
  readonly listed: boolean;
}

interface Marker {
  readonly name: string;
  readonly at: LonLat;
}

type Resolved =
  | {kind: 'country'; name: string}
  | {kind: 'group'; countries: readonly string[]; view?: readonly number[]}
  | null;

function resolvePlace(name: string): Resolved {
  const country = resolveCountry(name);
  if (country) return {kind: 'country', name: country};
  const group = resolveGroup(name);
  if (group) {
    return {
      kind: 'group',
      countries: group.members,
      ...(group.view ? {view: group.view} : {}),
    };
  }
  return null;
}

function placeHint(name: string): string {
  const close = [
    ...suggestCountry(name),
    ...GROUP_NAMES.filter(g => g.includes(name.toLowerCase())),
  ];
  return close.length
    ? `did you mean ${close
        .slice(0, 3)
        .map(c => `"${c}"`)
        .join(' or ')}?`
    : 'use a country ("Nigeria", "USA"), a continent ("Africa") or a region ("West Africa")';
}

/** The names a list-or-record field mentions, with any colour given. */
function entries(value: Value | undefined): {name: string; color?: string}[] {
  if (typeof value === 'string') return [{name: value}];
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string')
      .map(name => ({name}));
  }
  if (isObject(value)) {
    return Object.entries(value).map(([name, color]) =>
      typeof color === 'string' ? {name, color} : {name},
    );
  }
  return [];
}

function markerList(
  value: Value | undefined,
): {name: string; at: Value | null}[] {
  if (Array.isArray(value)) {
    return value.map(v =>
      typeof v === 'string' ? {name: v, at: null} : {name: '', at: v},
    );
  }
  if (isObject(value)) {
    return Object.entries(value).map(([name, at]) => ({name, at}));
  }
  return [];
}

function routeStops(route: string): string[] {
  return route
    .split(/\s*(?:->|→)\s*/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ---- projection -------------------------------------------------------------

interface View {
  readonly projection: GeoProjection;
  readonly spec: Record<string, Value>;
  readonly globe: boolean;
}

function round(value: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

/** Sample the edges of a lon/lat window, for fitting a view to it. */
function windowPoints(view: readonly number[]): LonLat[] {
  const [w, s, e, n] = view;
  const points: LonLat[] = [];
  for (let i = 0; i <= 8; i++) {
    const lon = w + ((e - w) * i) / 8;
    const lat = s + ((n - s) * i) / 8;
    points.push([lon, s], [lon, n], [w, lat], [e, lat]);
  }
  return points;
}

function outlinePoints(countries: readonly string[]): LonLat[] {
  const points: LonLat[] = [];
  for (const name of countries) {
    for (const polygon of mainPolygons(countryGeo(name).geometry)) {
      for (const [lon, lat] of polygon[0]) points.push([lon, lat]);
    }
  }
  return points;
}

/**
 * The projection, computed here exactly as the engine will build it: the
 * fitted scale and translate are written into the spec, so the engine does
 * no fitting of its own and every label lands on the shape it names.
 */
function buildView(
  box: Box,
  globe: boolean,
  target: LonLat[] | null,
  fill: number,
): View {
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const clip: [Vec, Vec] = [
    [-halfW, -halfH],
    [halfW, halfH],
  ];
  const multi = target?.length
    ? {type: 'MultiPoint', coordinates: target}
    : null;
  const [lon0, lat0] = multi ? geoCentroid(multi) : [0, 0];
  let projection: GeoProjection;
  let kind: string;
  let rotate: [number, number, number];
  let fitTo: unknown;
  let margin = fill;
  if (globe) {
    kind = 'orthographic';
    projection = geoOrthographic().clipAngle(90);
    rotate = [round(-lon0, 2), round(-Math.max(-60, Math.min(60, lat0)), 2), 0];
    fitTo = {type: 'Sphere'};
    margin = 0.94;
  } else if (!multi) {
    kind = 'naturalEarth1';
    projection = geoNaturalEarth1();
    rotate = [0, 0, 0];
    fitTo = {type: 'Sphere'};
    margin = 0.97;
  } else {
    const lons = target!.map(p => p[0]);
    const span = Math.max(...lons) - Math.min(...lons);
    kind = span > 70 ? 'naturalEarth1' : 'mercator';
    projection = kind === 'mercator' ? geoMercator() : geoNaturalEarth1();
    rotate = [round(-lon0, 2), 0, 0];
    fitTo = multi;
  }
  projection.rotate(rotate);
  projection.fitExtent(
    [
      [-halfW * margin, -halfH * margin],
      [halfW * margin, halfH * margin],
    ],
    fitTo,
  );
  const scale = round(projection.scale());
  const translate = projection.translate().map(v => round(v)) as Vec;
  projection.scale(scale).translate(translate);
  if (!globe) projection.clipExtent(clip);
  return {
    projection,
    globe,
    spec: {
      kind,
      rotate,
      scale,
      translate,
      ...(globe ? {} : {clipExtent: clip}),
    },
  };
}

function project(view: View, point: LonLat): Vec | null {
  if (view.globe) {
    // Behind the globe: not visible, not labelled.
    const rotate = view.projection.rotate();
    const centre: LonLat = [-rotate[0], -rotate[1]];
    const lambda = ((point[0] - centre[0]) * Math.PI) / 180;
    const phi = (point[1] * Math.PI) / 180;
    const phi0 = (centre[1] * Math.PI) / 180;
    const cosC =
      Math.sin(phi0) * Math.sin(phi) +
      Math.cos(phi0) * Math.cos(phi) * Math.cos(lambda);
    if (cosC < 0.05) return null;
  }
  const out = view.projection(point);
  if (!out || !Number.isFinite(out[0]) || !Number.isFinite(out[1])) return null;
  return [out[0], out[1]];
}

// ---- label placement ----------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Rect, b: Rect, gap = 10): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w + gap * 2 &&
    Math.abs(a.y - b.y) * 2 < a.h + b.h + gap * 2
  );
}

function inside(rect: Rect, half: {w: number; h: number}): boolean {
  return (
    rect.x - rect.w / 2 > -half.w + 8 &&
    rect.x + rect.w / 2 < half.w - 8 &&
    rect.y - rect.h / 2 > -half.h + 8 &&
    rect.y + rect.h / 2 < half.h - 8
  );
}

function pointInRings(p: Vec, rings: Vec[][]): boolean {
  let hit = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (
        yi > p[1] !== yj > p[1] &&
        p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi
      ) {
        hit = !hit;
      }
    }
  }
  return hit;
}

function distanceToRings(p: Vec, rings: Vec[][]): number {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const len = dx * dx + dy * dy || 1;
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len),
      );
      best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
    }
  }
  return best;
}

function projectRings(
  view: View,
  polygons: GeoJSON.Polygon['coordinates'][],
): Vec[][] {
  const rings: Vec[][] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const projected = ring
        .map(p => project(view, [p[0], p[1]]))
        .filter((p): p is Vec => p !== null);
      if (projected.length >= 3) rings.push(projected);
    }
  }
  return rings;
}

/** The centre, corners and edge midpoints of a rectangle. */
function samples(rect: Rect): Vec[] {
  const out: Vec[] = [];
  for (const fx of [-0.5, 0, 0.5]) {
    for (const fy of [-0.5, 0, 0.5]) {
      out.push([rect.x + rect.w * fx, rect.y + rect.h * fy]);
    }
  }
  return out;
}

function rectWithin(rect: Rect, rings: Vec[][]): boolean {
  return samples(rect).every(p => pointInRings(p, rings));
}

function rectTouches(rect: Rect, rings: Vec[][]): boolean {
  return samples(rect).some(p => pointInRings(p, rings));
}

/**
 * Where a label can sit inside a shape: visible points ordered by how far
 * they are from its edges, the first being the pole of inaccessibility - so
 * a label for Chile or Norway lands in the country rather than off its coast.
 */
function labelAnchor(
  rings: Vec[][],
  half: {w: number; h: number},
): {point: Vec; candidates: Vec[]} | null {
  if (!rings.length) return null;
  const xs = rings.flat().map(p => p[0]);
  const ys = rings.flat().map(p => p[1]);
  const x0 = Math.max(Math.min(...xs), -half.w + 20);
  const x1 = Math.min(Math.max(...xs), half.w - 20);
  const y0 = Math.max(Math.min(...ys), -half.h + 20);
  const y1 = Math.min(Math.max(...ys), half.h - 20);
  if (x1 <= x0 || y1 <= y0) return null;
  const scored: {p: Vec; room: number}[] = [];
  const steps = 32;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p: Vec = [
        x0 + ((x1 - x0) * i) / steps,
        y0 + ((y1 - y0) * j) / steps,
      ];
      if (pointInRings(p, rings)) {
        scored.push({p, room: distanceToRings(p, rings)});
      }
    }
  }
  if (!scored.length) {
    // A sliver the grid missed: its projected centre.
    const centre: Vec = [(x0 + x1) / 2, (y0 + y1) / 2];
    return {point: centre, candidates: []};
  }
  scored.sort((a, b) => b.room - a.room);
  return {point: scored[0].p, candidates: scored.slice(0, 80).map(c => c.p)};
}

/** Candidate label centres around a point, nearest first. */
function around(
  point: Vec,
  rect: {w: number; h: number},
  distance: number,
): Vec[] {
  const out: Vec[] = [];
  for (const d of [distance, distance + 40, distance + 90]) {
    const dx = rect.w / 2 + d;
    const dy = rect.h / 2 + d;
    out.push(
      [point[0] + dx, point[1]],
      [point[0] - dx, point[1]],
      [point[0], point[1] - dy],
      [point[0], point[1] + dy],
      [point[0] + dx * 0.8, point[1] - dy],
      [point[0] - dx * 0.8, point[1] - dy],
      [point[0] + dx * 0.8, point[1] + dy],
      [point[0] - dx * 0.8, point[1] + dy],
    );
  }
  return out;
}

// ---- the kit -------------------------------------------------------------------

const FIELDS = [
  'focus',
  'view',
  'highlight',
  'regions',
  'labels',
  'borders',
  'markers',
  'routes',
  'graticule',
  'color',
  ...PLACEMENT_FIELDS,
];

export const map: KitSpec = {
  name: 'map',
  summary:
    'A real map: the world, a continent, a region or a few countries, flat or as a globe. Name countries, regions and cities in plain words; the kit draws true borders, shades and labels them, marks cities and draws great-circle routes.',
  fields: {
    focus: {
      type: '"world" | continent | region | country | list of them',
      doc: 'What the map frames: "world", "Africa", "West Africa", "Nigeria", ["Ghana", "Togo"]. Default: whatever is highlighted and marked, else the world.',
    },
    view: {
      type: '"flat" | "globe"',
      doc: 'A flat map (default) or a globe turned to face the focus.',
    },
    highlight: {
      type: 'list of names, or {name: colour}',
      doc: 'Countries, continents or regions to shade: ["Nigeria", "Ghana"] or {"Nigeria": "green", "Sahel": "yellow"}. A continent or region is shaded as one outline.',
    },
    regions: {
      type: '{label: [countries] }',
      doc: 'Your own groupings, each shaded as one outline with its label: {"ECOWAS core": ["Nigeria", "Ghana", "Benin"]}.',
    },
    labels: {
      type: 'true | false | list of names',
      doc: 'Label every shaded area (default), none, or exactly these countries.',
    },
    borders: {type: 'boolean', doc: 'Draw country borders (default true).'},
    markers: {
      type: 'list of city names, or {name: [longitude, latitude]}',
      doc: 'Cities to mark: ["Lagos", "Accra"] (major cities are known), or {"Base camp": [86.9, 28.0]}.',
    },
    routes: {
      type: 'list of "A->B" (or "A->B->C")',
      doc: 'Great-circle routes between markers or known cities, drawn with an arrow; traceable in a beat.',
    },
    graticule: {
      type: 'boolean',
      doc: 'Latitude/longitude lines (default: on for a globe, off for a flat map).',
    },
    color: {
      type: 'theme colour name or CSS colour',
      doc: 'The first highlight colour (default blue); later ones cycle the accents.',
    },
    region: {
      type: 'full | left | right | center | top | bottom',
      doc: 'Where it goes (default full).',
    },
    box: {
      type: '[centreX, centreY, width, height]',
      doc: 'An explicit stage box instead of a region.',
    },
  },
  parts:
    '"<id>.<name>" for any highlighted country or region, marker or route as written ("map.Nigeria", "map.West Africa", "map.Lagos", "map.Lagos->London"); also "<id>.borders", "<id>.labels", "<id>.markers", "<id>.routes". A beat may show or highlight any country, even one not listed.',
  example: {
    id: 'map',
    kit: 'map',
    focus: 'West Africa',
    highlight: ['Nigeria', 'Ghana'],
    markers: ['Lagos', 'Accra'],
    routes: ['Lagos->Accra'],
  },

  validate(node) {
    const errors = new FieldErrors(node);
    errors.onlyFields(FIELDS);
    checkPlacement(node, errors);
    const focus = node.focus;
    if (focus !== undefined) {
      const names =
        typeof focus === 'string'
          ? [focus]
          : Array.isArray(focus)
            ? focus
            : null;
      if (!names || !names.every(n => typeof n === 'string')) {
        errors.error('focus', 'focus is a name or a list of names');
      } else {
        for (const name of names as string[]) {
          if (
            name.toLowerCase() !== 'world' &&
            !resolvePlace(name) &&
            !resolveCity(name)
          ) {
            errors.error('focus', `unknown place "${name}"`, placeHint(name));
          }
        }
      }
    }
    if (
      node.view !== undefined &&
      node.view !== 'flat' &&
      node.view !== 'globe'
    ) {
      errors.error('view', 'view is "flat" or "globe"');
    }
    const highlight = node.highlight;
    if (
      highlight !== undefined &&
      !(
        typeof highlight === 'string' ||
        Array.isArray(highlight) ||
        isObject(highlight)
      )
    ) {
      errors.error(
        'highlight',
        'highlight is a list of names or {name: colour}',
      );
    }
    for (const {name, color} of entries(highlight)) {
      if (!resolvePlace(name)) {
        errors.error(
          'highlight',
          `unknown country or region "${name}"`,
          placeHint(name),
        );
      }
      if (
        color !== undefined &&
        !(color in THEME_HEX) &&
        !chroma.valid(color)
      ) {
        errors.error(
          'highlight',
          `"${color}" is not a colour`,
          'a theme name ("green") or a CSS colour',
        );
      }
    }
    if (node.regions !== undefined) {
      if (!isObject(node.regions)) {
        errors.error('regions', 'regions is {label: [country, ...]}');
      } else {
        for (const [label, members] of Object.entries(node.regions)) {
          const list = typeof members === 'string' ? [members] : members;
          if (!Array.isArray(list) || !list.length) {
            errors.error(
              'regions',
              `region "${label}" needs a list of countries`,
            );
            continue;
          }
          for (const member of list) {
            if (typeof member !== 'string' || !resolvePlace(member)) {
              errors.error(
                'regions',
                `region "${label}": unknown country ${JSON.stringify(member)}`,
                typeof member === 'string' ? placeHint(member) : undefined,
              );
            }
          }
        }
      }
    }
    const labels = node.labels;
    if (labels !== undefined && typeof labels !== 'boolean') {
      if (!Array.isArray(labels) || !labels.every(l => typeof l === 'string')) {
        errors.error('labels', 'labels is true, false, or a list of names');
      } else {
        for (const name of labels as string[]) {
          if (!resolvePlace(name)) {
            errors.error(
              'labels',
              `unknown country or region "${name}"`,
              placeHint(name),
            );
          }
        }
      }
    }
    for (const field of ['borders', 'graticule']) {
      if (node[field] !== undefined && typeof node[field] !== 'boolean') {
        errors.error(field, `${field} is true or false`);
      }
    }
    const markers = node.markers;
    if (
      markers !== undefined &&
      !Array.isArray(markers) &&
      !isObject(markers)
    ) {
      errors.error(
        'markers',
        'markers is a list of city names or {name: [longitude, latitude]}',
      );
    }
    for (const {name, at} of markerList(markers)) {
      if (at === null) {
        if (!resolveCity(name)) {
          const close = suggestCity(name);
          errors.error(
            'markers',
            `unknown city "${name}"`,
            close.length
              ? `did you mean ${close.map(c => `"${c}"`).join(' or ')}? Otherwise give coordinates: {"${name}": [longitude, latitude]}`
              : `give its coordinates: {"${name}": [longitude, latitude]}`,
          );
        }
      } else if (!name) {
        errors.error(
          'markers',
          'a marker in a list is a city name; use {name: [longitude, latitude]} for coordinates',
        );
      } else if (
        !isNumberPair(at) ||
        Math.abs(at[0]) > 180 ||
        Math.abs(at[1]) > 90
      ) {
        errors.error(
          'markers',
          `marker "${name}" needs [longitude, latitude] in degrees, got ${JSON.stringify(at)}`,
          'longitude first (-180 to 180, east positive), then latitude (-90 to 90)',
        );
      }
    }
    const known = new Set(markerList(markers).map(m => m.name.toLowerCase()));
    const routes = node.routes;
    if (routes !== undefined) {
      const list = typeof routes === 'string' ? [routes] : routes;
      if (!Array.isArray(list) || !list.every(r => typeof r === 'string')) {
        errors.error('routes', 'routes is a list of "A->B" strings');
      } else {
        for (const route of list as string[]) {
          const stops = routeStops(route);
          if (stops.length < 2) {
            errors.error(
              'routes',
              `route "${route}" needs at least two stops, written "A->B"`,
            );
          }
          for (const stop of stops) {
            if (!known.has(stop.toLowerCase()) && !resolveCity(stop)) {
              errors.error(
                'routes',
                `route "${route}": "${stop}" is not a marker or a known city`,
                `add it to markers with coordinates: {"${stop}": [longitude, latitude]}`,
              );
            }
          }
        }
      }
    }
    return errors.issues;
  },

  expand(node, context): KitExpansion {
    const box = placementBox(node);
    const id = node.id;
    const half = {w: box.width / 2, h: box.height / 2};
    const stage = (p: Vec): [number, number] => [
      Math.round(box.x + p[0]),
      Math.round(box.y + p[1]),
    ];
    const globe = node.view === 'globe';
    const referenced = context.referenced ?? new Set<string>();

    // ---- what is on the map ----
    // Colours the author chose are never handed out again automatically.
    const chosen = new Set(
      entries(node.highlight).flatMap(e => (e.color ? [e.color] : [])),
    );
    const palette = [
      ...(typeof node.color === 'string' ? [node.color] : []),
      ...ACCENTS,
    ].filter((c, i, all) => all.indexOf(c) === i);
    let accent = 0;
    const nextColor = () => {
      const open = palette.filter(c => !chosen.has(c));
      const pool = open.length ? open : palette;
      return pool[accent++ % pool.length];
    };
    const areas: Area[] = [];
    const areaByName = new Map<string, Area>();
    const addArea = (area: Area) => {
      areas.push(area);
      areaByName.set(area.name, area);
    };
    for (const {name, color} of entries(node.highlight)) {
      const place = resolvePlace(name)!;
      addArea({
        name,
        countries: place.kind === 'country' ? [place.name] : place.countries,
        merged: place.kind === 'group',
        color: color ?? nextColor(),
        listed: true,
      });
    }
    for (const [name, members] of Object.entries(
      isObject(node.regions) ? node.regions : {},
    )) {
      const list = (
        typeof members === 'string' ? [members] : (members as string[])
      )
        .map(m => resolvePlace(m)!)
        .flatMap(p => (p.kind === 'country' ? [p.name] : p.countries));
      addArea({
        name,
        countries: list,
        merged: true,
        color: nextColor(),
        listed: true,
      });
    }
    // A beat may show a country the kit never listed: it gets a layer too.
    const markerInputs = markerList(node.markers);
    const markers: Marker[] = [];
    const markerByName = new Map<string, Marker>();
    const addMarker = (name: string, at: LonLat) => {
      if (markerByName.has(name.toLowerCase())) return;
      const marker = {name, at};
      markers.push(marker);
      markerByName.set(name.toLowerCase(), marker);
    };
    for (const {name, at} of markerInputs) {
      addMarker(
        name,
        at === null ? [...resolveCity(name)!] : (at as unknown as LonLat),
      );
    }
    const routes = (
      typeof node.routes === 'string'
        ? [node.routes]
        : ((node.routes as string[]) ?? [])
    ).map(route => ({name: route, stops: routeStops(route)}));
    for (const route of routes) {
      for (const stop of route.stops) {
        if (!markerByName.has(stop.toLowerCase())) {
          addMarker(stop, [...resolveCity(stop)!]);
        }
      }
    }
    const reserved = new Set(['borders', 'labels', 'markers', 'routes', '']);
    for (const name of referenced) {
      if (
        reserved.has(name) ||
        areaByName.has(name) ||
        markerByName.has(name.toLowerCase())
      ) {
        continue;
      }
      if (routes.some(r => r.name === name)) continue;
      const place = resolvePlace(name);
      if (!place) continue;
      addArea({
        name,
        countries: place.kind === 'country' ? [place.name] : place.countries,
        merged: place.kind === 'group',
        color: nextColor(),
        listed: false,
      });
    }

    // ---- the view ----
    const focusNames =
      typeof node.focus === 'string'
        ? [node.focus]
        : Array.isArray(node.focus)
          ? (node.focus as string[])
          : [];
    let target: LonLat[] | null = null;
    let fill = 0.78;
    if (
      focusNames.length &&
      focusNames.every(n => n.toLowerCase() === 'world')
    ) {
      target = null;
    } else if (focusNames.length) {
      target = [];
      for (const name of focusNames) {
        const place = resolvePlace(name);
        const city = resolveCity(name);
        if (place?.kind === 'group' && place.view) {
          target.push(...windowPoints(place.view));
          fill = 0.97;
        } else if (place) {
          target.push(
            ...outlinePoints(
              place.kind === 'country' ? [place.name] : place.countries,
            ),
          );
        } else if (city) {
          target.push(
            ...windowPoints([
              city[0] - 8,
              city[1] - 5,
              city[0] + 8,
              city[1] + 5,
            ]),
          );
        }
      }
    } else if (areas.some(a => a.listed) || markers.length) {
      target = [
        ...outlinePoints(areas.filter(a => a.listed).flatMap(a => a.countries)),
        ...markers.map(m => m.at),
      ];
      if (target.length === 1) {
        const [lon, lat] = target[0];
        target = windowPoints([lon - 10, lat - 6, lon + 10, lat + 6]);
      }
    }
    const view = buildView(box, globe, target, fill);
    // At world, continent and globe scale 1:50m coastlines are finer than a
    // pixel; the 1:110m layers look the same and draw five times faster on
    // every frame. Shaded countries keep full detail.
    const coarse = globe || (view.spec.scale as number) < 700;

    // ---- nodes ----
    const nodes: SceneNode[] = [];
    const touches: Touch[] = [];
    const parts = new Map<string, KitPart>();
    const mapId = `${id}_map`;
    const base = (nodeId: string, reason: string) =>
      touches.push({a: nodeId, b: '*', reason});
    nodes.push({
      id: mapId,
      component: 'GeoMap',
      fixed: true,
      props: {
        projection: view.spec,
        width: box.width,
        height: box.height,
        position: [box.x, box.y],
      },
    });
    base(mapId, 'the map is the ground everything on it sits on');
    const child = (n: SceneNode) =>
      nodes.push({...n, parent: mapId, fixed: true});

    child({
      id: `${id}_ocean`,
      component: 'GeoSphere',
      props: {
        fill: OCEAN,
        ...(globe ? {stroke: '#9DB5C3', lineWidth: 2} : {}),
      },
    });
    base(`${id}_ocean`, 'the sea under the map');
    const graticule = node.graticule ?? globe;
    if (graticule) {
      child({
        id: `${id}_graticule`,
        component: 'GeoGraticule',
        props: {stroke: GRATICULE, lineWidth: 1, step: [20, 20]},
      });
      base(`${id}_graticule`, 'latitude and longitude lines under the map');
    }
    child({
      id: `${id}_land`,
      component: 'GeoPath',
      props: {
        feature: {$engine: coarse ? 'WORLD_COUNTRIES_110M' : 'WORLD_COUNTRIES'},
        fill: LAND,
      },
    });
    base(`${id}_land`, 'the land of the map');

    const areaNodes = new Map<
      string,
      {fill: string; overlay?: string; labels?: string[]}
    >();
    const areaFeature = (area: Area): Value =>
      area.merged
        ? {
            $engine: 'countriesFeature',
            args: [area.countries as string[], slug(area.name)],
          }
        : {$engine: 'countryFeature', args: [area.countries[0]]};
    areas.forEach((area, index) => {
      const fillId = `${id}_a${index}${slug(area.name).slice(0, 16)}`;
      child({
        id: fillId,
        component: 'GeoPath',
        props: {
          feature: areaFeature(area),
          fill: tint(area.color),
          ...(area.merged ? {stroke: hexOf(area.color), lineWidth: 3} : {}),
          ...(area.listed ? {} : {opacity: 0}),
        },
      });
      base(fillId, `${area.name} is shaded on the map`);
      areaNodes.set(area.name, {fill: fillId});
    });
    if (node.borders !== false) {
      child({
        id: `${id}_borders`,
        component: 'GeoPath',
        props: {
          feature: coarse
            ? {$engine: 'WORLD_BORDERS_110M'}
            : {$engine: 'countryBordersFeature'},
          stroke: BORDER,
          lineWidth: 1.4,
        },
      });
      base(`${id}_borders`, 'country borders on the map');
      parts.set('borders', {nodes: [`${id}_borders`]});
    }
    // Highlight overlays: a bold outline a beat fades in, then out.
    for (const name of context.highlighted) {
      const area = areaByName.get(name);
      if (!area) continue;
      const overlayId = `${areaNodes.get(name)!.fill}Hi`;
      child({
        id: overlayId,
        component: 'GeoPath',
        props: {
          feature: area.merged
            ? areaFeature(area)
            : {$engine: 'countryFeature', args: [area.countries[0]]},
          fill: hexOf(area.color),
          stroke: THEME_HEX.ink,
          lineWidth: 4,
          opacity: 0,
        },
      });
      base(overlayId, `${name} lights up on the map`);
      areaNodes.get(name)!.overlay = overlayId;
    }

    // ---- routes ----
    const obstacles: Rect[] = [];
    const routeIds: string[] = [];
    routes.forEach((route, index) => {
      const points: Vec[] = [];
      for (let s = 0; s + 1 < route.stops.length; s++) {
        const a = markerByName.get(route.stops[s].toLowerCase())!.at;
        const b = markerByName.get(route.stops[s + 1].toLowerCase())!.at;
        const along = geoInterpolate(a, b);
        for (let i = s === 0 ? 0 : 1; i <= 40; i++) {
          const p = project(view, along(i / 40));
          if (p) points.push(p);
        }
      }
      const drawn = points
        .map(p => stage(p))
        .filter(
          (p, i, all) =>
            i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1],
        );
      if (drawn.length < 2) return;
      const routeId = `${id}_r${index}`;
      nodes.push({
        id: routeId,
        component: 'Line',
        fixed: true,
        halo: 2,
        props: {
          points: drawn,
          stroke: THEME_HEX.coral,
          lineWidth: 4,
          endArrow: true,
          arrowSize: 16,
          arrowStyle: 'swept',
        },
      });
      base(routeId, `the route ${route.name} crosses the map`);
      routeIds.push(routeId);
      parts.set(route.name, {nodes: [routeId], traceable: [routeId]});
      for (const p of points) obstacles.push({x: p[0], y: p[1], w: 10, h: 10});
    });
    if (routeIds.length) {
      parts.set('routes', {nodes: routeIds, traceable: routeIds});
    }

    // ---- markers ----
    const markerIds: string[] = [];
    const placed: Rect[] = [];
    const markerDots = new Map<string, {dot: string; point: Vec}>();
    markers.forEach((marker, index) => {
      const p = project(view, marker.at);
      if (!p || !inside({x: p[0], y: p[1], w: 16, h: 16}, half)) return;
      const dotId = `${id}_m${index}`;
      nodes.push({
        id: dotId,
        component: 'Circle',
        fixed: true,
        props: {
          size: 18,
          fill: THEME_HEX.ink,
          stroke: HALO,
          lineWidth: 3,
          position: stage(p),
        },
      });
      base(dotId, `${marker.name} is a point on the map`);
      placed.push({x: p[0], y: p[1], w: 20, h: 20});
      markerDots.set(marker.name, {dot: dotId, point: p});
      markerIds.push(dotId);
      for (const routeId of routeIds) {
        touches.push({
          a: dotId,
          b: routeId,
          reason: 'the route starts or ends at this city',
        });
      }
    });

    const labelIds: string[] = [];
    const text = (
      labelId: string,
      label: string,
      at: Vec,
      size: number,
      weight: number,
    ): SceneNode => ({
      id: labelId,
      component: 'Txt',
      fixed: true,
      // The kit spaces labels itself, 10px apart; a small audit halo keeps
      // the audit agreeing with that spacing.
      halo: 4,
      props: {
        text: label,
        fontSize: size,
        fontWeight: weight,
        fill: THEME_HEX.ink,
        position: stage(at),
      },
    });
    const free = (rect: Rect) =>
      inside(rect, half) &&
      !placed.some(r => overlaps(rect, r)) &&
      !obstacles.some(r => overlaps(rect, r, 2));

    // Marker labels: beside the dot, on whichever side is clear.
    markers.forEach((marker, index) => {
      const dot = markerDots.get(marker.name);
      if (!dot) return;
      const size = {
        w: labelWidth(marker.name, MARKER_LABEL_SIZE),
        h: MARKER_LABEL_SIZE * 1.3,
      };
      const spot =
        around(dot.point, size, 8).find(c =>
          free({x: c[0], y: c[1], ...size}),
        ) ?? ([dot.point[0] + size.w / 2 + 14, dot.point[1]] as Vec);
      const labelId = `${id}_m${index}Label`;
      nodes.push(text(labelId, marker.name, spot, MARKER_LABEL_SIZE, 600));
      touches.push({
        a: labelId,
        b: dot.dot,
        reason: 'the city name sits beside its dot',
      });
      placed.push({x: spot[0], y: spot[1], ...size});
      parts.set(marker.name, {nodes: [dot.dot, labelId]});
    });
    if (markerIds.length) parts.set('markers', {nodes: markerIds});

    // Area labels: inside the shape when it fits, else beside it with a leader.
    const labelNames =
      node.labels === false
        ? []
        : Array.isArray(node.labels)
          ? (node.labels as string[])
          : areas.map(a => a.name);
    const ringsOf = (countries: readonly string[], merged: boolean) =>
      projectRings(
        view,
        merged
          ? mainPolygons(mergedGeo(countries))
          : (() => {
              const largest = largestPolygon(countryGeo(countries[0]).geometry);
              return largest ? [largest] : [];
            })(),
      );
    // Every shaded shape, so a label moved outside its own country is not
    // set down on top of another one.
    const shaded = areas
      .filter(a => a.listed)
      .map(a => ({name: a.name, rings: ringsOf(a.countries, a.merged)}));
    const labelled = labelNames
      .map(name => {
        const area = areaByName.get(name);
        const place = area ? null : resolvePlace(name);
        const countries =
          area?.countries ??
          (place
            ? place.kind === 'country'
              ? [place.name]
              : place.countries
            : []);
        const merged = area?.merged ?? place?.kind === 'group';
        const rings =
          shaded.find(s => s.name === name)?.rings ??
          ringsOf(countries, merged);
        return {name, merged, rings, anchor: labelAnchor(rings, half)};
      })
      .filter(l => l.anchor !== null)
      // Hardest first: small shapes have the fewest places a label fits.
      .sort(
        (a, b) => a.anchor!.candidates.length - b.anchor!.candidates.length,
      );
    labelled.forEach((entry, index) => {
      const {point, candidates} = entry.anchor!;
      const baseSize = entry.merged ? LABEL_SIZE + 4 : LABEL_SIZE;
      const labelId = `${id}_l${index}`;
      const nodesForPart = [labelId];
      let within: {at: Vec; size: number; rect: Rect} | null = null;
      for (const fontSize of [baseSize, baseSize - 4, baseSize - 7]) {
        const dims = {w: labelWidth(entry.name, fontSize), h: fontSize * 1.3};
        for (const c of candidates) {
          const rect = {x: c[0], y: c[1], ...dims};
          if (rectWithin(rect, entry.rings) && free(rect)) {
            within = {at: c, size: fontSize, rect};
            break;
          }
        }
        if (within) break;
      }
      if (within) {
        nodes.push(text(labelId, entry.name, within.at, within.size, 700));
        placed.push(within.rect);
      } else {
        const fontSize = baseSize - 4;
        const dims = {w: labelWidth(entry.name, fontSize), h: fontSize * 1.3};
        const others = shaded.filter(o => o.name !== entry.name);
        const options = around(point, dims, 16)
          .map(c => ({x: c[0], y: c[1], ...dims}))
          .filter(free);
        const rect = options.find(
          r =>
            !others.some(o => rectTouches(r, o.rings)) &&
            !rectTouches(r, entry.rings),
        ) ??
          options.find(r => !others.some(o => rectTouches(r, o.rings))) ??
          options[0] ?? {x: point[0], y: point[1] - dims.h, ...dims};
        const spot: Vec = [rect.x, rect.y];
        nodes.push(text(labelId, entry.name, spot, fontSize, 700));
        placed.push(rect);
        // A leader from the label's nearest edge to the shape.
        const edge: Vec = [
          Math.max(
            spot[0] - dims.w / 2,
            Math.min(point[0], spot[0] + dims.w / 2),
          ),
          Math.max(
            spot[1] - dims.h / 2,
            Math.min(point[1], spot[1] + dims.h / 2),
          ),
        ];
        if (Math.hypot(edge[0] - point[0], edge[1] - point[1]) > 12) {
          const leaderId = `${labelId}Leader`;
          nodes.push({
            id: leaderId,
            component: 'Line',
            fixed: true,
            halo: 0,
            props: {
              points: [stage(point), stage(edge)],
              stroke: THEME_HEX.ink,
              lineWidth: 2,
            },
          });
          touches.push({
            a: leaderId,
            b: labelId,
            reason: 'the leader points from the name to its place',
          });
          base(leaderId, 'a thin leader line over the map');
          nodesForPart.push(leaderId);
        }
      }
      labelIds.push(...nodesForPart);
      const area = areaByName.get(entry.name);
      if (area && !area.listed) {
        for (const n of nodesForPart) {
          const labelNode = nodes.find(x => x.id === n)!;
          nodes[nodes.indexOf(labelNode)] = {
            ...labelNode,
            props: {...labelNode.props, opacity: 0},
          };
        }
      }
      if (area) areaNodes.get(entry.name)!.labels = nodesForPart;
      else parts.set(entry.name, {nodes: nodesForPart});
    });
    if (labelIds.length) parts.set('labels', {nodes: labelIds});

    for (const area of areas) {
      const entry = areaNodes.get(area.name)!;
      parts.set(area.name, {
        nodes: [entry.fill, ...(entry.labels ?? [])],
        ...(entry.overlay ? {overlay: entry.overlay} : {}),
      });
    }
    parts.set('', {
      nodes: nodes.filter(n => n.props?.opacity !== 0).map(n => n.id),
    });
    return {nodes, touches, parts};
  },
};
