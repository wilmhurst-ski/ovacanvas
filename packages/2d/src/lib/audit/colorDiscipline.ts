import {theme} from '../theme/theme';
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

  const distinctColors = new Set(hits.map(hit => hit.hex));
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
