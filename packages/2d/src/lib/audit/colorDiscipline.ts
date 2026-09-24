import {theme, typeScale} from '../theme/theme';
import type {AuditFinding, AuditableNode} from './types';
import {DEFAULT_VISIBLE_OPACITY_THRESHOLD} from './types';

export interface ColorDisciplineOptions {
  /**
   * Distinct non-neutral colors allowed across all text/Latex in one beat,
   * before the theme's `ink`/`secondaryInk` fallback would otherwise apply.
   *
   * @remarks
   * Defaults to 2, not `visual-system.md`'s "one primary accent + at most
   * two supporting accents" (a whole-board budget of up to 3, shared with
   * every shape and diagram element): text gets a slightly smaller share of
   * that budget, leaving at least one accent free for the board's own
   * geometry. Caught empirically, not guessed: a budget of 1 rejected a real
   * scene that colors a Pythagorean triangle's two known legs (`a`, `b`)
   * blue and its unknown hypotenuse (`c`) coral - two colors, each reused
   * across the labels that share its semantic role ("known quantity" vs.
   * "unknown"), which is exactly the palette's own documented meaning for
   * those colors, not decoration. What actually distinguishes that from
   * "every text got its own color" is reuse: a real semantic scheme repeats
   * a color across everything playing the same role, while the failure this
   * check exists for gives *every single label* a color nothing else
   * shares. Counting distinct colors is a coarser proxy for that, but a
   * budget of 2 passes every real case seen so far and still refuses three
   * or more.
   */
  readonly maxAccentColors?: number;
  readonly opacityThreshold?: number;
}

interface ColorHit {
  readonly nodeKey: string;
  readonly hex: string;
}

/** Duck-types `fill()`'s return as the real `Color` it is on an actual `Shape`, without importing `Color`/`Gradient`/`Pattern` into this module. */
function resolvedHex(node: AuditableNode): string | null {
  if (typeof node.fill !== 'function') return null;
  const value = node.fill() as {hex?: () => string} | null | undefined;
  if (!value || typeof value.hex !== 'function') return null;
  return value.hex().toLowerCase();
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/**
 * The colour a text's fill stands for. A highlight fading in or out passes
 * through mixes of ink and its accent (`#2b61c4`, `#3066ca` on the way to
 * blue); each of those is the same deliberate accent, not a new colour, so a
 * fill lying on the line between a neutral and an accent counts as that
 * accent - or as neutral when it is still mostly ink. Anything else counts
 * as itself.
 */
function colourFamily(
  hex: string,
  neutrals: readonly string[],
  accents: readonly string[],
): string | null {
  const c = rgb(hex);
  let best: {family: string | null; distance: number} = {
    family: hex,
    distance: 18,
  };
  for (const n of neutrals) {
    const a0 = rgb(n);
    for (const accent of accents) {
      const a1 = rgb(accent);
      const d = [a1[0] - a0[0], a1[1] - a0[1], a1[2] - a0[2]];
      const len = d[0] * d[0] + d[1] * d[1] + d[2] * d[2] || 1;
      const t = Math.max(
        0,
        Math.min(
          1,
          ((c[0] - a0[0]) * d[0] +
            (c[1] - a0[1]) * d[1] +
            (c[2] - a0[2]) * d[2]) /
            len,
        ),
      );
      const distance = Math.hypot(
        c[0] - (a0[0] + d[0] * t),
        c[1] - (a0[1] + d[1] * t),
        c[2] - (a0[2] + d[2] * t),
      );
      if (distance < best.distance) {
        best = {family: t < 0.2 ? null : accent, distance};
      }
    }
  }
  return best.family;
}

/**
 * Refuse a beat that gave its text/Latex more distinct accent colors than
 * the theme allows - the engine-enforced half of "black for text and Latex
 * is enough."
 *
 * @remarks
 * The concrete trigger: a generation pass that, left to its own devices,
 * gave every label its own color instead of reusing the theme's `ink` - a
 * default (`Txt`/`Latex` now fall back to `theme().ink`) only helps an
 * author who sets no color at all. An author (or a generator) that
 * deliberately sets a different `fill` on every text node sails straight
 * past any default, the same way a plain-text equation sails past nothing
 * stopping it from *not* being `Latex` - see `collectPlainTextMathNotation`
 * for the same shape of problem applied to notation instead of color. This
 * is the enforcement that makes the intent in `visual-system.md` - "never
 * use color as the only distinction," "at most two supporting accents" -
 * stick even when a default gets overridden, rather than a rule that only
 * holds as long as nobody sets a color.
 *
 * Walks the full visible tree from `root`, not just registered items, the
 * same closed-world reach as {@link collectPlainTextMathNotation} and
 * {@link collectUnregisteredVisibleNodes}.
 */
export function collectColorOveruse(
  root: AuditableNode,
  options: ColorDisciplineOptions = {},
): AuditFinding[] {
  const maxAccentColors = options.maxAccentColors ?? 2;
  const opacityThreshold =
    options.opacityThreshold ?? DEFAULT_VISIBLE_OPACITY_THRESHOLD;
  const neutral = new Set([
    theme().ink.toLowerCase(),
    theme().secondaryInk.toLowerCase(),
  ]);
  const accents = [
    theme().blue,
    theme().cyan,
    theme().coral,
    theme().yellow,
    theme().green,
    theme().magenta,
  ].map(c => c.toLowerCase());

  const hits: ColorHit[] = [];

  const visit = (node: AuditableNode): void => {
    if (node.absoluteOpacity() <= opacityThreshold) return;

    const isTextOrMath =
      typeof node.text === 'function' || typeof node.tex === 'function';
    if (isTextOrMath) {
      const hex = resolvedHex(node);
      if (hex && !neutral.has(hex)) {
        hits.push({nodeKey: node.key, hex});
      }
    }

    for (const child of node.children()) visit(child);
  };

  for (const child of root.children()) visit(child);

  const distinctColors = new Set(
    hits
      .map(hit => colourFamily(hit.hex, [...neutral], accents))
      .filter((family): family is string => family !== null),
  );
  if (distinctColors.size <= maxAccentColors) return [];

  return [
    {
      ruleId: 'color-discipline',
      severity: 'blocking',
      entities: hits.map(hit => hit.nodeKey),
      message:
        `${distinctColors.size} distinct accent colors in use across text/Latex ` +
        `(${[...distinctColors].join(', ')}), more than the ${maxAccentColors} allowed here. ` +
        `Text and Latex should default to the theme's ink color; color is for one deliberate, ` +
        `consistent highlight, not decoration.`,
    },
  ];
}

export interface ThemeConsistencyOptions {
  /** Opacity threshold below which nodes are ignored. */
  readonly opacityThreshold?: number;
  /**
   * Allowed font size deviation from a typeScale role in pixels.
   * Defaults to 1px.
   */
  readonly fontSizeTolerance?: number;
  /** Explicit allowed hex colors. Defaults to all active theme() token values. */
  readonly allowedColors?: readonly string[];
  /** Explicit allowed font sizes in pixels. Defaults to typeScale role sizes. */
  readonly allowedFontSizes?: readonly number[];
}

/**
 * Audit rule verifying theme token discipline:
 * 1. Checks that node fill colors match documented `theme()` tokens rather than
 *    arbitrary off-palette hex codes.
 * 2. Checks that typography font sizes match documented `typeScale` roles.
 *
 * All findings are strictly advisory (`severity: 'advisory'`) so stylistic suggestions
 * guide the authoring loop without blocking candidate presentation.
 */
export function collectThemeConsistency(
  root: AuditableNode,
  options: ThemeConsistencyOptions = {},
): AuditFinding[] {
  const opacityThreshold =
    options.opacityThreshold ?? DEFAULT_VISIBLE_OPACITY_THRESHOLD;
  const fontSizeTolerance = options.fontSizeTolerance ?? 1;

  const currentTheme = theme();
  const allowedColors = new Set(
    (options.allowedColors ?? Object.values(currentTheme)).map(c =>
      c.toLowerCase(),
    ),
  );

  const roles = Object.entries(typeScale);
  const allowedFontSizes =
    options.allowedFontSizes ?? roles.map(([, role]) => role.fontSize);

  const findings: AuditFinding[] = [];

  const visit = (node: AuditableNode): void => {
    if (node.absoluteOpacity() <= opacityThreshold) return;

    // 1. Palette check: fill should match a theme token
    const hex = resolvedHex(node);
    if (hex && !allowedColors.has(hex)) {
      findings.push({
        ruleId: 'theme-color-consistency',
        severity: 'advisory',
        entities: [node.key],
        message:
          `Node "${node.key}" uses off-palette color "${hex}". ` +
          `Colors should match design tokens from theme() rather than arbitrary hex values.`,
      });
    }

    // 2. Typography check: text/math font sizes should match typeScale roles
    const isTextOrMath =
      typeof node.text === 'function' || typeof node.tex === 'function';
    if (isTextOrMath && typeof node.fontSize === 'function') {
      const size = node.fontSize();
      if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
        const matchesRole = allowedFontSizes.some(
          target => Math.abs(size - target) <= fontSizeTolerance,
        );
        if (!matchesRole) {
          const roleSummary = roles
            .map(([name, role]) => `${name}: ${role.fontSize}px`)
            .join(', ');
          findings.push({
            ruleId: 'theme-typography-scale',
            severity: 'advisory',
            entities: [node.key],
            message:
              `Text node "${node.key}" has fontSize ${size}px, which does not match any typeScale role ` +
              `(${roleSummary}). Use standard typeScale roles for typographic consistency.`,
          });
        }
      }
    }

    for (const child of node.children()) visit(child);
  };

  const targets = root.children().length > 0 ? root.children() : [root];
  for (const target of targets) visit(target);

  return findings;
}
