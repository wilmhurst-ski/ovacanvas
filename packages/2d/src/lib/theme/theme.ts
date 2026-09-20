/**
 * The default visual system's tokens, promoted from prose
 * (`references/visual-system.md`) into the engine.
 *
 * @remarks
 * Before this module, the palette lived only as a markdown table an author
 * had to read and manually reproduce - every real scene independently
 * retyped the same six-ish hex constants (`derivatives.tsx`, and every
 * one-shot demo built against this engine so far). A rule that only lives in
 * prose is a rule that eventually gets forgotten, mistyped, or drifted from;
 * this is the same fix this project has already made twice for other rules
 * (Latex-vs-plain-text, unregistered visible nodes): stop trusting an author
 * to remember, and make the correct value the one that requires no effort.
 *
 * `theme()` is deliberately not a frozen constant: `visual-system.md` itself
 * says "explicit product themes may replace them while preserving hierarchy
 * and restraint," so `setTheme`/`resetTheme` let a host application swap the
 * active palette without touching engine code, while `defaultTheme` ships
 * the documented values so nothing has to opt in to get them.
 */

export interface Theme {
  /** Full canvas. */
  readonly paper: string;
  /** Optional subject-owned surface, such as a plot plane. */
  readonly clearField: string;
  /** Titles, geometry, primary labels - and the default for text/Latex fill. */
  readonly ink: string;
  /** Premises, minor labels, notes. */
  readonly secondaryInk: string;
  /** Grids, construction guides, subject-owned boundaries. */
  readonly hairline: string;
  /** Primary series, known quantity, correspondence. */
  readonly blue: string;
  /** Secondary directional or spatial cue. */
  readonly cyan: string;
  /** Contrast, change, exception, unknown. */
  readonly coral: string;
  /** Highlight, selected region, attention. */
  readonly yellow: string;
  /** Valid state, conserved part, comparison. */
  readonly green: string;
  /** Alternate family or tertiary category. */
  readonly magenta: string;
}

export const defaultTheme: Theme = {
  paper: '#F7F4EC',
  clearField: '#FFFDFC',
  ink: '#151922',
  secondaryInk: '#59616D',
  hairline: '#D8D9D4',
  blue: '#2F66D0',
  cyan: '#2EAEDC',
  coral: '#F05A3C',
  yellow: '#F3C742',
  green: '#4E9B62',
  magenta: '#B968A7',
};

let ActiveTheme: Theme = defaultTheme;

/** The currently active theme. Read this, not `defaultTheme`, for a live value. */
export function theme(): Theme {
  return ActiveTheme;
}

/** Replace some or all of the active theme's tokens. */
export function setTheme(overrides: Partial<Theme>): void {
  ActiveTheme = {...ActiveTheme, ...overrides};
}

/** Restore the documented default theme, discarding any `setTheme` overrides. */
export function resetTheme(): void {
  ActiveTheme = defaultTheme;
}

/**
 * A role's type-scale preset: one representative size/weight from
 * `visual-system.md`'s documented range, not the whole range - a concrete
 * default has to pick one number, so this picks the range's midpoint.
 */
export interface TypeScaleRole {
  readonly fontSize: number;
  readonly fontWeight: number;
}

/** Reference sizes at 1920x1080, per `visual-system.md`'s typography table. Scale proportionally for other delivery sizes. */
export const typeScale: Readonly<
  Record<
    'title' | 'subtitle' | 'heading' | 'body' | 'diagramLabel' | 'denseLabel',
    TypeScaleRole
  >
> = {
  title: {fontSize: 60, fontWeight: 700},
  subtitle: {fontSize: 32, fontWeight: 450},
  heading: {fontSize: 25, fontWeight: 700},
  body: {fontSize: 27, fontWeight: 450},
  diagramLabel: {fontSize: 26, fontWeight: 600},
  denseLabel: {fontSize: 20, fontWeight: 500},
};

/**
 * Reference stroke widths at 1920px width, per `visual-system.md`'s stroke
 * table. Advisory values for an author/generator to reach for - unlike the
 * palette, not wired into any component's default: a shape with no stroke
 * width is correctly invisible by default, and which rung of this ladder
 * applies depends on what the stroke is *for* (a grid vs. an active
 * emphasis), which no generic default could guess.
 */
export const strokeWidths = {
  grid: 1.25,
  outline: 2.5,
  primary: 3.5,
  emphasis: 5,
} as const;

/** Reference spacing at 1920x1080, per `visual-system.md`'s spacing list. Advisory, for the same reason as `strokeWidths`. */
export const spacing = {
  titleToSubtitle: 16,
  subtitleToFigure: 38,
  labelToGeometry: 13,
  groupGap: 34,
  clusterGap: 76,
} as const;
