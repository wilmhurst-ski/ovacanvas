import {ROBOTO_FACES} from './roboto';

export {ROBOTO_FACES, type EmbeddedFontFace} from './roboto';

/** The family text nodes default to (`Layout.fontFamily`). */
export const ENGINE_FONT_FAMILY = 'Roboto';

/** The one load, shared by every caller. */
const LOADING: {promise?: Promise<void>} = {};

/**
 * Register the engine's own text font and wait until it can draw.
 *
 * @remarks
 * Text is measured the moment a node lays out, and a font that arrives
 * later changes nothing already measured - so this must resolve before a
 * scene is built. The faces are embedded (no network, no asset pipeline),
 * registered once, and given every weight the variable font has, so text
 * roles at 450, 600 or 700 draw at their real weight rather than a
 * synthesized one. Outside a browser (tests, Node) there is nothing to
 * register and it resolves at once.
 */
export function loadEngineFonts(): Promise<void> {
  if (LOADING.promise) return LOADING.promise;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
    LOADING.promise = Promise.resolve();
    return LOADING.promise;
  }
  LOADING.promise = (async () => {
    const faces = ROBOTO_FACES.map(
      face =>
        new FontFace(
          ENGINE_FONT_FAMILY,
          `url(data:font/woff2;base64,${face.woff2}) format('woff2')`,
          {weight: '100 900', style: 'normal', unicodeRange: face.unicodeRange},
        ),
    );
    await Promise.all(
      faces.map(async face => {
        try {
          document.fonts.add(await face.load());
        } catch {
          // A face that cannot load leaves the browser's fallback for its
          // characters; the rest still draw in the engine's font.
        }
      }),
    );
  })();
  return LOADING.promise;
}
