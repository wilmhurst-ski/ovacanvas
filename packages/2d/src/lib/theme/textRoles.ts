import {Txt, TxtProps} from '../components/Txt';
import {theme, typeScale} from './theme';

/**
 * Preset constructors over the type scale in `visual-system.md`, so a scene
 * reaches for "this is the title" rather than re-deriving a font size and
 * weight by eye every time.
 *
 * @remarks
 * These are factory functions, not `Node` subclasses: a role is nothing
 * more than a different set of default prop values for the same `Txt`
 * (no new signal, no new behaviour), so a subclass would only add a name
 * with no capability behind it. Every value is still just a default -
 * `title({fontSize: 80})` overrides exactly like any other `Txt` prop,
 * since the role's preset is spread first and the caller's props last.
 */

function textRole(
  preset: {fontSize: number; fontWeight: number},
  props: TxtProps,
): Txt {
  return new Txt({
    fontSize: preset.fontSize,
    fontWeight: preset.fontWeight,
    fill: theme().ink,
    ...props,
  });
}

/** A board's own title: `visual-system.md`'s "board title" role. */
export function title(props: TxtProps): Txt {
  return textRole(typeScale.title, props);
}

/** A board's thesis/subtitle line, shorter and lighter than the title. */
export function subtitle(props: TxtProps): Txt {
  return textRole(typeScale.subtitle, {fill: theme().secondaryInk, ...props});
}

/** A short local orientation heading within a board. */
export function heading(props: TxtProps): Txt {
  return textRole(typeScale.heading, props);
}

/** Ordinary explanatory prose or evidence text. */
export function bodyText(props: TxtProps): Txt {
  return textRole(typeScale.body, props);
}

/** A label placed against a diagram's own geometry. */
export function diagramLabel(props: TxtProps): Txt {
  return textRole(typeScale.diagramLabel, props);
}

/** A dense secondary label, for when delivery resolution supports it. */
export function denseLabel(props: TxtProps): Txt {
  return textRole(typeScale.denseLabel, {fill: theme().secondaryInk, ...props});
}
