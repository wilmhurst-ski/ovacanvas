import type {Value} from '../document/model.js';
import {isObject} from '../document/values.js';
import type {FieldErrors} from './fields.js';

/**
 * Data on a plot's axes: bar charts, line charts, scatter plots.
 *
 * @remarks
 * A chart is values against axes, which is what a plot already is - so data
 * is three more kinds of mark on the same frame, not a separate kit. Bars
 * stand on categories ("Jan", "Feb" - the x axis becomes those names);
 * lines and dots stand on numbers when their keys are numbers, and on
 * categories otherwise. Functions, points and data share the axes, so a
 * scatter plot can carry its trend line and a bar chart its average.
 */

export const DATA_KINDS = ['bars', 'lines', 'dots'] as const;
export type DataKind = (typeof DATA_KINDS)[number];

export interface Datum {
  /** Position on x: the category's index, or the number itself. */
  readonly x: number;
  readonly y: number;
  readonly category?: string;
}

export interface Series {
  readonly name: string;
  readonly kind: DataKind;
  readonly data: readonly Datum[];
}

export interface ParsedData {
  readonly series: readonly Series[];
  /** The category names along x, when the data stands on categories. */
  readonly categories: readonly string[] | null;
}

const SERIES_NAME = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
const DEFAULT_NAME: Readonly<Record<DataKind, string>> = {
  bars: 'bars',
  lines: 'line',
  dots: 'dots',
};

type Raw = {kind: DataKind; name: string; entries: [string | number, number][]};

/** Read one series' values: named values, [x, y] pairs, or a plain list. */
function entriesOf(
  value: Value,
  where: string,
  errors?: FieldErrors,
): [string | number, number][] | null {
  if (Array.isArray(value)) {
    if (value.every(v => typeof v === 'number' && Number.isFinite(v))) {
      return (value as number[]).map((v, i) => [String(i + 1), v]);
    }
    if (
      value.every(
        v =>
          Array.isArray(v) &&
          v.length === 2 &&
          v.every(n => typeof n === 'number' && Number.isFinite(n)),
      )
    ) {
      return (value as number[][]).map(([x, y]) => [x, y]);
    }
    errors?.error(
      where.split('.')[0],
      `${where} is a list of numbers or of [x, y] pairs`,
    );
    return null;
  }
  if (isObject(value)) {
    const out: [string, number][] = [];
    for (const [key, v] of Object.entries(value)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors?.error(
          where.split('.')[0],
          `${where}: "${key}" must be a number`,
        );
        return null;
      }
      out.push([key, v]);
    }
    return out;
  }
  errors?.error(where.split('.')[0], `${where} is {"label": value, ...} or [[x, y], ...]`);
  return null;
}

function isSingle(value: Value): boolean {
  if (Array.isArray(value)) {
    return value.every(
      v => typeof v === 'number' || (Array.isArray(v) && v.every(n => typeof n === 'number')),
    );
  }
  return isObject(value) && Object.values(value).every(v => typeof v === 'number');
}

export function parseData(
  node: Readonly<Record<string, Value | undefined>>,
  errors?: FieldErrors,
): ParsedData {
  const raws: Raw[] = [];
  for (const kind of DATA_KINDS) {
    const value = node[kind];
    if (value === undefined) continue;
    if (isSingle(value)) {
      const entries = entriesOf(value, kind, errors);
      if (entries) raws.push({kind, name: DEFAULT_NAME[kind], entries});
    } else if (isObject(value)) {
      // Several named series: {"2019": {...}, "2020": {...}}.
      for (const [name, series] of Object.entries(value)) {
        if (!SERIES_NAME.test(name)) {
          errors?.error(
            kind,
            `series name "${name}" must be letters and digits, starting with a letter`,
            'e.g. {"rain2019": {...}, "rain2020": {...}}',
          );
          continue;
        }
        const entries = entriesOf(series, `${kind}.${name}`, errors);
        if (entries) raws.push({kind, name, entries});
      }
    } else {
      errors?.error(
        kind,
        `${kind} is {"label": value, ...}, [[x, y], ...], or {"series": {...}, ...}`,
      );
    }
  }
  if (!raws.length) return {series: [], categories: null};
  // Bars always stand on categories; lines and dots on numbers when every
  // key is one.
  const numeric = (r: Raw) =>
    r.kind !== 'bars' &&
    r.entries.every(([k]) => typeof k === 'number' || /^-?\d+(\.\d+)?$/.test(k));
  const categorical = raws.filter(r => !numeric(r));
  if (categorical.length && categorical.length < raws.length) {
    errors?.error(
      raws.find(numeric)!.kind,
      'this chart mixes data on categories with data on numbers',
      'give every series the same kind of keys (all names, or all numbers)',
    );
  }
  const names = new Set<string>();
  for (const r of raws) {
    if (names.has(r.name)) {
      errors?.error(r.kind, `two data series are both called "${r.name}"`);
    }
    names.add(r.name);
  }
  if (categorical.length) {
    const categories: string[] = [];
    for (const r of raws) {
      for (const [k] of r.entries) {
        if (!categories.includes(String(k))) categories.push(String(k));
      }
    }
    return {
      categories,
      series: raws.map(r => ({
        name: r.name,
        kind: r.kind,
        data: r.entries.map(([k, y]) => ({
          x: categories.indexOf(String(k)),
          y,
          category: String(k),
        })),
      })),
    };
  }
  return {
    categories: null,
    series: raws.map(r => ({
      name: r.name,
      kind: r.kind,
      data: r.entries
        .map(([k, y]) => ({x: Number(k), y}))
        .sort((a, b) => a.x - b.x),
    })),
  };
}
