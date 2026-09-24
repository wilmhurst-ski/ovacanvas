import * as fontkit from 'fontkit';
import {ROBOTO_TTF} from './roboto-ttf.js';

/**
 * Text measured with the font the engine draws it in.
 *
 * @remarks
 * The engine registers an embedded variable Roboto before any beat renders
 * (`loadEngineFonts`), so a text node is exactly as wide on every machine.
 * These are the same faces (as TTF, which fontkit can set a weight on):
 * a label's width here is its width on screen, so layout - where a label
 * goes, whether a box is wide enough, where a line wraps - is decided on
 * what will be drawn rather than on a rule of thumb about letter widths.
 */

interface Face {
  readonly ranges: readonly [number, number][];
  readonly font: fontkit.Font;
}

/** The faces, read once; and each face at each weight asked for. */
const FACES: {list?: Face[]} = {};
const BY_WEIGHT = new Map<string, fontkit.Font>();

function parseRanges(text: string): [number, number][] {
  return text.split(',').map(part => {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-');
    const lo = parseInt(a, 16);
    return [lo, b ? parseInt(b, 16) : lo];
  });
}

function loadFaces(): Face[] {
  if (!FACES.list) {
    FACES.list = ROBOTO_TTF.map(face => {
      const bytes = Uint8Array.from(atob(face.ttf), c => c.charCodeAt(0));
      const font = fontkit.create(bytes as unknown as Buffer) as fontkit.Font;
      return {ranges: parseRanges(face.unicodeRange), font};
    });
  }
  return FACES.list;
}

/** The face that covers a character (the first one, Latin, otherwise). */
function faceFor(code: number): number {
  const all = loadFaces();
  const index = all.findIndex(f =>
    f.ranges.some(([lo, hi]) => code >= lo && code <= hi),
  );
  return index === -1 ? 0 : index;
}

function atWeight(index: number, weight: number): fontkit.Font {
  const key = `${index}:${weight}`;
  let font = BY_WEIGHT.get(key);
  if (!font) {
    const base = loadFaces()[index].font;
    font = base.variationAxes?.wght ? base.getVariation({wght: weight}) : base;
    BY_WEIGHT.set(key, font);
  }
  return font;
}

const WIDTHS = new Map<string, number>();

/**
 * How wide a single line of text is, in pixels, at a font size and weight
 * (the engine's default weight is 500).
 */
export function measureText(
  text: string,
  fontSize: number,
  weight = 500,
): number {
  const key = `${weight}|${text}`;
  let units = WIDTHS.get(key);
  if (units === undefined) {
    // Runs of characters that one face covers, laid out with its kerning.
    units = 0;
    let run = '';
    let runFace = -1;
    const flush = () => {
      if (!run) return;
      const font = atWeight(runFace, weight);
      units! += (font.layout(run).advanceWidth / font.unitsPerEm) * 1000;
      run = '';
    };
    for (const char of text) {
      const face = faceFor(char.codePointAt(0) ?? 32);
      if (face !== runFace) {
        flush();
        runFace = face;
      }
      run += char;
    }
    flush();
    WIDTHS.set(key, units);
  }
  return (units / 1000) * fontSize;
}
