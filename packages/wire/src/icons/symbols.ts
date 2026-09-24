/* eslint-disable @typescript-eslint/naming-convention -- symbol and terminal names are written as a textbook writes them ("ac-source", "+") */
/**
 * Schematic symbol families: drawings a UI icon set does not have, made to
 * the conventions a textbook uses, each with named terminals where wires
 * attach.
 *
 * @remarks
 * Coordinates are centred on the origin, y down. A two-terminal symbol runs
 * from (-24, 0) to (24, 0), so any two can be chained in a line and a
 * circuit layout never needs to know what is inside one. `stroke` is drawn
 * as lines; `fill` (optional) as solid shapes - a diode's triangle, a
 * junction dot. A family is just a table: adding chemistry glassware or
 * network gear later means adding another table like these.
 */
export interface SymbolDef {
  readonly family: string;
  readonly stroke: string;
  readonly fill?: string;
  /** Where wires attach, by terminal name. */
  readonly terminals: Readonly<Record<string, readonly [number, number]>>;
  /** Half the drawn height, for spacing labels and rows. */
  readonly halfHeight: number;
  /** Words it can be asked for by. */
  readonly tags: readonly string[];
  /** A switch that is open: nothing flows through it. */
  readonly open?: boolean;
  /** Something that lights up when current flows (a lamp, an LED). */
  readonly glows?: boolean;
}

const TWO: SymbolDef['terminals'] = {a: [-24, 0], b: [24, 0]};
const CIRCLE = 'M-9 0A9 9 0 1 0 9 0A9 9 0 1 0 -9 0Z';
const LEADS_CIRCLE = `M-24 0H-9M9 0H24${CIRCLE}`;

export const ELECTRICAL: Readonly<Record<string, SymbolDef>> = {
  resistor: {
    family: 'electrical',
    stroke: 'M-24 0H-12L-10 -5L-6 5L-2 -5L2 5L6 -5L10 5L12 0H24',
    terminals: TWO,
    halfHeight: 6,
    tags: ['resistance', 'ohm', 'load'],
  },
  'resistor-box': {
    family: 'electrical',
    stroke: 'M-24 0H-12M12 0H24M-12 -5H12V5H-12Z',
    terminals: TWO,
    halfHeight: 6,
    tags: ['resistor', 'iec'],
  },
  'variable-resistor': {
    family: 'electrical',
    stroke:
      'M-24 0H-12L-10 -5L-6 5L-2 -5L2 5L6 -5L10 5L12 0H24M-10 9L9 -10M4 -10H9V-5',
    terminals: TWO,
    halfHeight: 10,
    tags: ['rheostat', 'potentiometer', 'variable'],
  },
  capacitor: {
    family: 'electrical',
    stroke: 'M-24 0H-3M-3 -9V9M3 -9V9M3 0H24',
    terminals: TWO,
    halfHeight: 9,
    tags: ['capacitance', 'condenser'],
  },
  'polarized-capacitor': {
    family: 'electrical',
    stroke: 'M-24 0H-3M-3 -9V9M4.5 -9Q2 0 4.5 9M3.2 0H24M-10 -9H-6M-8 -11V-7',
    terminals: TWO,
    halfHeight: 11,
    tags: ['electrolytic', 'capacitor'],
  },
  inductor: {
    family: 'electrical',
    stroke:
      'M-24 0H-12A3 3 0 0 1 -6 0A3 3 0 0 1 0 0A3 3 0 0 1 6 0A3 3 0 0 1 12 0H24',
    terminals: TWO,
    halfHeight: 4,
    tags: ['coil', 'inductance', 'choke'],
  },
  battery: {
    family: 'electrical',
    stroke:
      'M-24 0H-7M-7 -10V10M-3 -5V5M1 -10V10M5 -5V5M5 0H24M-14 -10H-10M-12 -12V-8',
    // The long plate is positive: + on the left.
    terminals: {'+': [-24, 0], '-': [24, 0], a: [-24, 0], b: [24, 0]},
    halfHeight: 12,
    tags: ['cells', 'power', 'source', 'dc', 'voltage'],
  },
  cell: {
    family: 'electrical',
    stroke: 'M-24 0H-3M-3 -10V10M3 -5V5M3 0H24M-10 -10H-6M-8 -12V-8',
    terminals: {'+': [-24, 0], '-': [24, 0], a: [-24, 0], b: [24, 0]},
    halfHeight: 12,
    tags: ['battery', 'source', 'dc'],
  },
  'dc-source': {
    family: 'electrical',
    stroke: `${LEADS_CIRCLE}M-6 0H-2M-4 -2V2M2 0H6`,
    terminals: {'+': [-24, 0], '-': [24, 0], a: [-24, 0], b: [24, 0]},
    halfHeight: 9,
    tags: ['voltage source', 'power supply', 'source'],
  },
  'ac-source': {
    family: 'electrical',
    stroke: `${LEADS_CIRCLE}M-6 0C-4.5 -6 -1.5 -6 0 0S4.5 6 6 0`,
    terminals: TWO,
    halfHeight: 9,
    tags: ['alternating', 'mains', 'generator', 'ac'],
  },
  lamp: {
    family: 'electrical',
    stroke: `${LEADS_CIRCLE}M-6.4 -6.4L6.4 6.4M6.4 -6.4L-6.4 6.4`,
    terminals: TWO,
    halfHeight: 9,
    tags: ['bulb', 'light', 'light bulb'],
    glows: true,
  },
  switch: {
    family: 'electrical',
    stroke: 'M-24 0H-10M-10 0L9 -9M10 0H24',
    fill: 'M-12 0A2 2 0 1 0 -8 0A2 2 0 1 0 -12 0ZM8 0A2 2 0 1 0 12 0A2 2 0 1 0 8 0Z',
    terminals: TWO,
    halfHeight: 10,
    tags: ['open switch', 'spst', 'switch open'],
    open: true,
  },
  'closed-switch': {
    family: 'electrical',
    stroke: 'M-24 0H-10M-10 0L10 0M10 0H24',
    fill: 'M-12 0A2 2 0 1 0 -8 0A2 2 0 1 0 -12 0ZM8 0A2 2 0 1 0 12 0A2 2 0 1 0 8 0Z',
    terminals: TWO,
    halfHeight: 3,
    tags: ['switch closed', 'switch on'],
  },
  'push-button': {
    family: 'electrical',
    stroke: 'M-24 0H-10M10 0H24M-12 -6H12M0 -6V-13',
    fill: 'M-12 0A2 2 0 1 0 -8 0A2 2 0 1 0 -12 0ZM8 0A2 2 0 1 0 12 0A2 2 0 1 0 8 0Z',
    terminals: TWO,
    halfHeight: 13,
    tags: ['button', 'push switch'],
    open: true,
  },
  diode: {
    family: 'electrical',
    stroke: 'M-24 0H-7M7 0H24M7 -8V8',
    fill: 'M-7 -8L7 0L-7 8Z',
    terminals: {anode: [-24, 0], cathode: [24, 0], a: [-24, 0], b: [24, 0]},
    halfHeight: 8,
    tags: ['rectifier'],
  },
  led: {
    family: 'electrical',
    stroke:
      'M-24 0H-7M7 0H24M7 -8V8M1 -10L6 -16M3 -16H6V-13M6 -8L11 -14M8 -14H11V-11',
    fill: 'M-7 -8L7 0L-7 8Z',
    terminals: {anode: [-24, 0], cathode: [24, 0], a: [-24, 0], b: [24, 0]},
    halfHeight: 16,
    tags: ['light emitting diode', 'light'],
    glows: true,
  },
  'zener-diode': {
    family: 'electrical',
    stroke: 'M-24 0H-7M7 0H24M4 -10L7 -8V8L10 10',
    fill: 'M-7 -8L7 0L-7 8Z',
    terminals: {anode: [-24, 0], cathode: [24, 0], a: [-24, 0], b: [24, 0]},
    halfHeight: 10,
    tags: ['zener', 'regulator'],
  },
  fuse: {
    family: 'electrical',
    stroke: 'M-24 0H24M-11 -5H11V5H-11Z',
    terminals: TWO,
    halfHeight: 6,
    tags: ['breaker', 'protection'],
  },
  ammeter: {
    family: 'electrical',
    stroke: `${LEADS_CIRCLE}M-4 5L0 -5L4 5M-2.5 1.5H2.5`,
    terminals: TWO,
    halfHeight: 9,
    tags: ['current meter', 'amps'],
  },
  voltmeter: {
    family: 'electrical',
    stroke: `${LEADS_CIRCLE}M-4 -5L0 5L4 -5`,
    terminals: TWO,
    halfHeight: 9,
    tags: ['voltage meter', 'volts'],
  },
  galvanometer: {
    family: 'electrical',
    stroke: `${LEADS_CIRCLE}M4 -3.5A4.5 5 0 1 0 4 3.5V0.5H1`,
    terminals: TWO,
    halfHeight: 9,
    tags: ['meter'],
  },
  motor: {
    family: 'electrical',
    stroke: `${LEADS_CIRCLE}M-4 5V-5L0 1L4 -5V5`,
    terminals: TWO,
    halfHeight: 9,
    tags: ['engine'],
  },
  generator: {
    family: 'electrical',
    stroke: `${LEADS_CIRCLE}M4 -3.5A4.5 5 0 1 0 4 3.5V0.5H1`,
    terminals: TWO,
    halfHeight: 9,
    tags: ['dynamo', 'alternator'],
  },
  buzzer: {
    family: 'electrical',
    stroke: 'M-24 0H-8V-4M8 0H24M8 0V-4M-10 -4H10A10 10 0 0 0 -10 -4Z',
    terminals: TWO,
    halfHeight: 11,
    tags: ['bell', 'alarm', 'beeper'],
  },
  speaker: {
    family: 'electrical',
    stroke: 'M-24 0H-8M-8 -5H-3V5H-8ZM-3 -5L5 -12V12L-3 5M5 0H24',
    terminals: TWO,
    halfHeight: 12,
    tags: ['loudspeaker', 'sound'],
  },
  heater: {
    family: 'electrical',
    stroke: 'M-24 0H-12M12 0H24M-12 -5H12V5H-12ZM-6 -5V5M0 -5V5M6 -5V5',
    terminals: TWO,
    halfHeight: 6,
    tags: ['heating element'],
  },
  thermistor: {
    family: 'electrical',
    stroke: 'M-24 0H-12M12 0H24M-12 -5H12V5H-12ZM-14 9H-8L10 -9',
    terminals: TWO,
    halfHeight: 10,
    tags: ['ntc', 'temperature sensor'],
  },
  ldr: {
    family: 'electrical',
    stroke:
      'M-24 0H-12M12 0H24M-12 -5H12V5H-12ZM-12 -18L-5 -9M-8 -9H-5V-12M-4 -20L3 -11M0 -11H3V-14',
    terminals: TWO,
    halfHeight: 20,
    tags: ['light dependent resistor', 'photoresistor', 'light sensor'],
  },
  'solar-cell': {
    family: 'electrical',
    stroke:
      'M-24 0H-3M-3 -10V10M3 -5V5M3 0H24M-16 -20L-8 -12M-11 -12H-8V-15M-8 -22L0 -14M-3 -14H0V-17',
    terminals: {'+': [-24, 0], '-': [24, 0], a: [-24, 0], b: [24, 0]},
    halfHeight: 22,
    tags: ['photovoltaic', 'solar panel', 'pv'],
  },
  ground: {
    family: 'electrical',
    stroke: 'M0 -14V0M-10 0H10M-6.5 4H6.5M-3 8H3',
    terminals: {a: [0, -14]},
    halfHeight: 14,
    tags: ['earth', 'gnd'],
  },
  antenna: {
    family: 'electrical',
    stroke: 'M0 14V-10M-9 -14L0 -4L9 -14',
    terminals: {a: [0, 14]},
    halfHeight: 14,
    tags: ['aerial', 'radio'],
  },
  'npn-transistor': {
    family: 'electrical',
    stroke:
      'M-24 0H-7M-7 -10V10M-7 -4L9 -13V-24M-7 4L9 13V24M-15 0A16 16 0 1 0 17 0A16 16 0 1 0 -15 0Z',
    fill: 'M9 13L2 12.6L5 7.5Z',
    terminals: {base: [-24, 0], collector: [9, -24], emitter: [9, 24]},
    halfHeight: 24,
    tags: ['transistor', 'bjt', 'npn'],
  },
  'pnp-transistor': {
    family: 'electrical',
    stroke:
      'M-24 0H-7M-7 -10V10M-7 -4L9 -13V-24M-7 4L9 13V24M-15 0A16 16 0 1 0 17 0A16 16 0 1 0 -15 0Z',
    fill: 'M-7 4L-1 3.3L-3 8.5Z',
    terminals: {base: [-24, 0], collector: [9, 24], emitter: [9, -24]},
    halfHeight: 24,
    tags: ['transistor', 'bjt', 'pnp'],
  },
  'op-amp': {
    family: 'electrical',
    stroke:
      'M-12 -16L16 0L-12 16ZM-24 -8H-12M-24 8H-12M16 0H24M-9 -8H-5M-9 8H-5M-7 6V10',
    terminals: {'-': [-24, -8], '+': [-24, 8], out: [24, 0]},
    halfHeight: 16,
    tags: ['operational amplifier', 'amplifier', 'opamp'],
  },
  transformer: {
    family: 'electrical',
    stroke:
      'M-24 -12H-6V-12A3 3 0 0 1 -6 -6A3 3 0 0 1 -6 0A3 3 0 0 1 -6 6A3 3 0 0 1 -6 12H-24M24 -12H6A3 3 0 0 0 6 -6A3 3 0 0 0 6 0A3 3 0 0 0 6 6A3 3 0 0 0 6 12H24M-1.5 -13V13M1.5 -13V13',
    terminals: {
      p1: [-24, -12],
      p2: [-24, 12],
      s1: [24, -12],
      s2: [24, 12],
    },
    halfHeight: 13,
    tags: ['coupled inductors', 'step up', 'step down'],
  },
  junction: {
    family: 'electrical',
    stroke: '',
    fill: 'M-3 0A3 3 0 1 0 3 0A3 3 0 1 0 -3 0Z',
    terminals: {a: [0, 0]},
    halfHeight: 3,
    tags: ['node', 'dot', 'connection'],
  },
};

/** IEEE distinctive-shape logic gates: inputs a, b on the left, out on the right. */
const INPUTS = 'M-24 -8H-12M-24 8H-12';
const AND_BODY = 'M-12 -14H0A14 14 0 0 1 0 14H-12Z';
const OR_BODY = 'M-14 -14Q-4 0 -14 14Q4 14 14 0Q4 -14 -14 -14Z';
const OR_INPUTS = 'M-24 -8H-10M-24 8H-10';
const BUBBLE = (x: number) => `M${x} 0A3 3 0 1 0 ${x + 6} 0A3 3 0 1 0 ${x} 0Z`;
const GATE_TERMINALS = {a: [-24, -8], b: [-24, 8], out: [24, 0]} as const;

export const LOGIC: Readonly<Record<string, SymbolDef>> = {
  and: {
    family: 'logic',
    stroke: `${INPUTS}${AND_BODY}M14 0H24`,
    terminals: GATE_TERMINALS,
    halfHeight: 14,
    tags: ['and gate', 'conjunction'],
  },
  nand: {
    family: 'logic',
    stroke: `${INPUTS}${AND_BODY}${BUBBLE(14)}M20 0H24`,
    terminals: GATE_TERMINALS,
    halfHeight: 14,
    tags: ['nand gate'],
  },
  or: {
    family: 'logic',
    stroke: `${OR_INPUTS}${OR_BODY}M14 0H24`,
    terminals: GATE_TERMINALS,
    halfHeight: 14,
    tags: ['or gate', 'disjunction'],
  },
  nor: {
    family: 'logic',
    stroke: `${OR_INPUTS}${OR_BODY}${BUBBLE(14)}M20 0H24`,
    terminals: GATE_TERMINALS,
    halfHeight: 14,
    tags: ['nor gate'],
  },
  xor: {
    family: 'logic',
    stroke: `${OR_INPUTS}${OR_BODY}M-19 -14Q-9 0 -19 14M14 0H24`,
    terminals: GATE_TERMINALS,
    halfHeight: 14,
    tags: ['xor gate', 'exclusive or'],
  },
  xnor: {
    family: 'logic',
    stroke: `${OR_INPUTS}${OR_BODY}M-19 -14Q-9 0 -19 14${BUBBLE(14)}M20 0H24`,
    terminals: GATE_TERMINALS,
    halfHeight: 14,
    tags: ['xnor gate', 'equivalence'],
  },
  not: {
    family: 'logic',
    stroke: `M-24 0H-10M-10 -11L8 0L-10 11Z${BUBBLE(8)}M14 0H24`,
    terminals: {in: [-24, 0], a: [-24, 0], out: [24, 0]},
    halfHeight: 11,
    tags: ['inverter', 'not gate', 'negation'],
  },
  buffer: {
    family: 'logic',
    stroke: 'M-24 0H-10M-10 -11L10 0L-10 11ZM10 0H24',
    terminals: {in: [-24, 0], a: [-24, 0], out: [24, 0]},
    halfHeight: 11,
    tags: ['buffer gate', 'repeater'],
  },
};

export const SYMBOL_FAMILIES: Readonly<
  Record<string, Readonly<Record<string, SymbolDef>>>
> = {electrical: ELECTRICAL, logic: LOGIC};
