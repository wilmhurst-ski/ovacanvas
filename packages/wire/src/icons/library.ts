import nodeModule from 'module';
import {suggest} from '../catalogue/index.js';
import {SYMBOL_FAMILIES, type SymbolDef} from './symbols.js';

/**
 * Every icon a document can name, found by the words people use.
 *
 * @remarks
 * Two sources. The general vocabulary is Lucide's icon set (ISC licence,
 * `data/LICENSE-lucide.txt`): 1,848 line icons on a 24-unit grid, each with
 * tags, built into `data/icons-lucide.json` by `scripts/build-icons.mjs`.
 * The symbol families (`symbols.ts`) add what a UI set lacks - schematic
 * symbols with terminals.
 *
 * A name resolves by, in order: an exact icon name; a family symbol
 * (`"electrical:battery"`, or a symbol name when a kit prefers symbols); a
 * small table of everyday words; the icons' own tags. So "thunder", "db",
 * "home" and "storage" all find something, and a name nothing matches comes
 * back with the closest real ones.
 */
export interface IconDef {
  /** The resolved name, `"lucide:zap"` or `"electrical:resistor"`. */
  readonly id: string;
  readonly name: string;
  readonly family: string;
  /** Stroke path, centred on the origin. */
  readonly stroke: string;
  readonly fill?: string;
  /** The span of the source drawing: 24 for icons, 48 for symbols. */
  readonly span: number;
  readonly symbol?: SymbolDef;
}

interface IconData {
  readonly icons: Readonly<Record<string, {d: string; tags: string[]}>>;
}

let Loaded: IconData | null = null;

/** Read on first use, like the map data: most documents have no icons. */
function icons(): IconData['icons'] {
  if (!Loaded) {
    Loaded = nodeModule.createRequire(import.meta.url)(
      '../../data/icons-lucide.json',
    ) as IconData;
  }
  return Loaded.icons;
}

/** Everyday words to the icon that usually stands for them. */
// Keys are phrases as people write them ("power-plant").
/* eslint-disable @typescript-eslint/naming-convention */
const SYNONYMS: Readonly<Record<string, string>> = {
  thunder: 'zap',
  lightning: 'zap',
  bolt: 'zap',
  electricity: 'zap',
  energy: 'zap',
  power: 'zap',
  storm: 'cloud-lightning',
  thunderstorm: 'cloud-lightning',
  db: 'database',
  storage: 'database',
  home: 'house',
  building: 'building-2',
  office: 'building-2',
  person: 'user',
  people: 'users',
  team: 'users',
  money: 'banknote',
  cash: 'banknote',
  dollar: 'dollar-sign',
  warning: 'triangle-alert',
  danger: 'triangle-alert',
  error: 'circle-x',
  ok: 'circle-check',
  success: 'circle-check',
  idea: 'lightbulb',
  email: 'mail',
  message: 'message-circle',
  chat: 'message-circle',
  computer: 'monitor',
  pc: 'monitor',
  settings: 'settings',
  gear: 'settings',
  cog: 'settings',
  world: 'globe',
  earth: 'earth',
  internet: 'globe',
  web: 'globe',
  time: 'clock',
  water: 'droplet',
  fire: 'flame',
  heat: 'flame',
  temperature: 'thermometer',
  rain: 'cloud-rain',
  snow: 'snowflake',
  tree: 'tree-pine',
  plant: 'sprout',
  leaf: 'leaf',
  sun: 'sun',
  solar: 'sun',
  wind: 'wind',
  cloud: 'cloud',
  car: 'car',
  truck: 'truck',
  plane: 'plane',
  ship: 'ship',
  train: 'train-front',
  factory: 'factory',
  chart: 'chart-column',
  graph: 'chart-line',
  analytics: 'chart-line',
  search: 'search',
  lock: 'lock',
  security: 'shield',
  key: 'key-round',
  user: 'user',
  phone: 'smartphone',
  mobile: 'smartphone',
  wifi: 'wifi',
  network: 'network',
  code: 'code',
  api: 'webhook',
  file: 'file',
  document: 'file-text',
  folder: 'folder',
  book: 'book-open',
  school: 'school',
  education: 'graduation-cap',
  heart: 'heart',
  health: 'heart-pulse',
  doctor: 'stethoscope',
  hospital: 'hospital',
  medicine: 'pill',
  atom: 'atom',
  science: 'flask-conical',
  chemistry: 'flask-conical',
  dna: 'dna',
  brain: 'brain',
  ai: 'brain-circuit',
  robot: 'bot',
  gift: 'gift',
  cart: 'shopping-cart',
  shop: 'store',
  store: 'store',
  bank: 'landmark',
  government: 'landmark',
  law: 'scale',
  justice: 'scale',
  map: 'map',
  location: 'map-pin',
  pin: 'map-pin',
  flag: 'flag',
  target: 'target',
  goal: 'target',
  rocket: 'rocket',
  launch: 'rocket',
  plug: 'plug',
  socket: 'plug',
  bulb: 'lightbulb',
  light: 'lightbulb',
  magnet: 'magnet',
  battery: 'battery-full',
  'lightning-bolt': 'zap',
  'power-plant': 'factory',
  'power-station': 'factory',
  'water-drop': 'droplet',
  drop: 'droplet',
  'light-bulb': 'lightbulb',
  'wind-turbine': 'wind',
  'data-center': 'server',
};
/* eslint-enable @typescript-eslint/naming-convention */

function normalise(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

function fromSymbol(family: string, name: string, symbol: SymbolDef): IconDef {
  return {
    id: `${family}:${name}`,
    name,
    family,
    stroke: symbol.stroke,
    ...(symbol.fill ? {fill: symbol.fill} : {}),
    span: 48,
    symbol,
  };
}

function fromLucide(name: string): IconDef {
  return {
    id: `lucide:${name}`,
    name,
    family: 'lucide',
    stroke: icons()[name].d,
    span: 24,
  };
}

/** A family symbol by name (and by tag when `byTag`), or null. */
function findSymbol(
  family: string | null,
  key: string,
  byTag = true,
): IconDef | null {
  const families = family
    ? {[family]: SYMBOL_FAMILIES[family] ?? {}}
    : SYMBOL_FAMILIES;
  const words = key.replace(/-/g, ' ');
  for (const [familyName, table] of Object.entries(families)) {
    if (table[key]) return fromSymbol(familyName, key, table[key]);
  }
  if (!byTag) return null;
  for (const [familyName, table] of Object.entries(families)) {
    for (const [name, symbol] of Object.entries(table)) {
      if (symbol.tags.includes(words)) {
        return fromSymbol(familyName, name, symbol);
      }
    }
  }
  return null;
}

/** The best icon for the words in a name, by name parts and tags. */
function searchIcons(key: string): string | null {
  const words = key.split('-').filter(Boolean);
  const phrase = words.join(' ');
  let best: {name: string; score: number} | null = null;
  for (const [name, icon] of Object.entries(icons())) {
    const parts = name.split('-');
    // The whole phrase as one tag ("light bulb") is the strongest signal.
    let score = words.length > 1 && icon.tags.includes(phrase) ? 4 : 0;
    for (const word of words) {
      const stem = word.replace(/s$/, '');
      if (parts.includes(word) || parts.includes(stem)) score += 3;
      else if (icon.tags.includes(word) || icon.tags.includes(stem)) score += 2;
      else if (icon.tags.some(t => t.split(' ').includes(word))) score += 1;
    }
    // Prefer the simplest icon among equals: fewer name parts, shorter name.
    score -= parts.length * 0.1 + name.length * 0.001;
    if (score >= 1.5 && (!best || score > best.score)) best = {name, score};
  }
  return best?.name ?? null;
}

export interface ResolveOptions {
  /** Try the symbol families before the icon set ("battery" is a schematic battery). */
  readonly preferSymbols?: boolean;
}

/** The icon a name stands for, or null. */
export function resolveIcon(
  name: string,
  options: ResolveOptions = {},
): IconDef | null {
  let key = normalise(name);
  let family: string | null = null;
  const prefixed = key.match(/^([a-z]+):(.+)$/);
  if (prefixed) {
    family = prefixed[1];
    key = prefixed[2];
  }
  // "battery symbol", "schematic resistor" ask for the schematic drawing.
  const symbolWords = /(^|-)(symbol|schematic|circuit)(-|$)/;
  const wantsSymbol = options.preferSymbols || symbolWords.test(key);
  key = key.replace(symbolWords, '$1').replace(/^-|-$/g, '') || key;

  if (family && family !== 'lucide') return findSymbol(family, key);
  const all = icons();
  if (wantsSymbol || family === null) {
    if (wantsSymbol) {
      const symbol = findSymbol(null, key);
      if (symbol) return symbol;
    }
  }
  if (all[key]) return fromLucide(key);
  if (family === 'lucide') {
    const found = searchIcons(key);
    return found ? fromLucide(found) : null;
  }
  // A symbol by its own name ("resistor"), then everyday words, then the
  // symbols by their tags, then the icons' tags.
  const symbol = findSymbol(null, key, false);
  if (symbol) return symbol;
  const synonym = SYNONYMS[key] ?? SYNONYMS[key.replace(/s$/, '')];
  if (synonym && all[synonym]) return fromLucide(synonym);
  // A symbol's own phrase ("and gate", "transistor") beats a fuzzy search.
  const tagged = findSymbol(null, key, true);
  if (tagged) return tagged;
  const found = searchIcons(key);
  return found ? fromLucide(found) : null;
}

/** Close real names, for a hint. */
export function suggestIcons(name: string): string[] {
  const key = normalise(name).replace(/^[a-z]+:/, '');
  return suggest(key, [
    ...Object.keys(icons()),
    ...Object.values(SYMBOL_FAMILIES).flatMap(t => Object.keys(t)),
  ]);
}

/** How many icons and symbols there are, for the reference. */
export function iconCount(): {icons: number; symbols: number} {
  return {
    icons: Object.keys(icons()).length,
    symbols: Object.values(SYMBOL_FAMILIES).reduce(
      (n, t) => n + Object.keys(t).length,
      0,
    ),
  };
}
