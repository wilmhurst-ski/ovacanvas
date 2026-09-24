/**
 * Build wire's icon data from a lucide-static package.
 *
 * Usage: node scripts/build-icons.mjs <path to an unpacked lucide-static>
 *
 * Every icon's elements (path, circle, rect, line, ellipse, polyline,
 * polygon) are turned into one SVG path string, centred on the origin (the
 * 24x24 viewBox moved to -12..12), with every number written out separately.
 * That last part matters: Lucide writes arc flags compactly ("a1.5 1.5 0
 * 00-2.474-1.561"), which the engine's path parser misreads as malformed.
 * Tags are kept, so a model can ask for "lightning" or "home" and find the
 * icon without knowing its exact name.
 */
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const source = process.argv[2];
if (!source) {
  console.error('usage: node scripts/build-icons.mjs <lucide-static dir>');
  process.exit(1);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '../data');
const nodes = JSON.parse(
  fs.readFileSync(path.join(source, 'icon-nodes.json'), 'utf8'),
);
const tags = JSON.parse(
  fs.readFileSync(path.join(source, 'tags.json'), 'utf8'),
);
const version = JSON.parse(
  fs.readFileSync(path.join(source, 'package.json'), 'utf8'),
).version;

const SHIFT = -12;
const fmt = n => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Parse SVG path data into [command, numbers[]] with arc flags read one digit at a time. */
function parsePath(d) {
  const out = [];
  let i = 0;
  const ws = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const number = () => {
    ws();
    const m = d.slice(i).match(/^[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/);
    if (!m) throw new Error(`bad number at ${i} in "${d}"`);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = () => {
    ws();
    const c = d[i];
    if (c !== '0' && c !== '1')
      throw new Error(`bad arc flag at ${i} in "${d}"`);
    i++;
    return Number(c);
  };
  const counts = {m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0};
  let command = null;
  while (true) {
    ws();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) command = d[i++];
    else if (!command) throw new Error(`no command at ${i} in "${d}"`);
    const lower = command.toLowerCase();
    if (lower === 'z') {
      out.push([command, []]);
      command = null;
      continue;
    }
    const args = [];
    for (let k = 0; k < counts[lower]; k++) {
      args.push(lower === 'a' && (k === 3 || k === 4) ? flag() : number());
    }
    out.push([command, args]);
    // Implicit repeats after a moveto are linetos.
    if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';
  }
  return out;
}

/**
 * Rewrite a path in absolute, explicit commands only: M, L, C, Q, A, Z.
 *
 * @remarks
 * The engine's path code has gaps a browser does not: a smooth curve (S)
 * right after a move takes the wrong first control point, radii too small
 * to span an arc are not scaled up, and a relative move reads from wherever
 * the previous element ended once elements are joined. Handing it nothing
 * but absolute lines, full curves and corrected arcs sidesteps every one of
 * them, whatever an icon's author wrote.
 */
function absolutize(parts) {
  const out = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCubic = null;
  let lastQuad = null;
  for (const [command, args] of parts) {
    const lower = command.toLowerCase();
    const rel = command === lower;
    const px = v => (rel ? x + v : v);
    const py = v => (rel ? y + v : v);
    let cubic = null;
    let quad = null;
    switch (lower) {
      case 'm':
        x = px(args[0]);
        y = py(args[1]);
        [startX, startY] = [x, y];
        out.push(['M', [x, y]]);
        break;
      case 'l':
        x = px(args[0]);
        y = py(args[1]);
        out.push(['L', [x, y]]);
        break;
      case 'h':
        x = px(args[0]);
        out.push(['L', [x, y]]);
        break;
      case 'v':
        y = py(args[0]);
        out.push(['L', [x, y]]);
        break;
      case 'c': {
        const c = [
          px(args[0]),
          py(args[1]),
          px(args[2]),
          py(args[3]),
          px(args[4]),
          py(args[5]),
        ];
        out.push(['C', c]);
        cubic = [c[2], c[3]];
        [x, y] = [c[4], c[5]];
        break;
      }
      case 's': {
        // The first control point mirrors the last curve's, or is the
        // current point when there was no curve just before.
        const c1 = lastCubic
          ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]]
          : [x, y];
        const c = [...c1, px(args[0]), py(args[1]), px(args[2]), py(args[3])];
        out.push(['C', c]);
        cubic = [c[2], c[3]];
        [x, y] = [c[4], c[5]];
        break;
      }
      case 'q': {
        const q = [px(args[0]), py(args[1]), px(args[2]), py(args[3])];
        out.push(['Q', q]);
        quad = [q[0], q[1]];
        [x, y] = [q[2], q[3]];
        break;
      }
      case 't': {
        const c1 = lastQuad
          ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]]
          : [x, y];
        const q = [...c1, px(args[0]), py(args[1])];
        out.push(['Q', q]);
        quad = c1;
        [x, y] = [q[2], q[3]];
        break;
      }
      case 'a': {
        const ex = px(args[5]);
        const ey = py(args[6]);
        let rx = Math.abs(args[0]);
        let ry = Math.abs(args[1]);
        // Radii too small to reach the end are scaled up (SVG F.6.6).
        const phi = (args[2] * Math.PI) / 180;
        const dx = (x - ex) / 2;
        const dy = (y - ey) / 2;
        const x1 = Math.cos(phi) * dx + Math.sin(phi) * dy;
        const y1 = -Math.sin(phi) * dx + Math.cos(phi) * dy;
        const lambda =
          rx && ry ? (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry) : 0;
        if (lambda > 1) {
          rx *= Math.sqrt(lambda) * 1.0001;
          ry *= Math.sqrt(lambda) * 1.0001;
        }
        out.push(['A', [rx, ry, args[2], args[3], args[4], ex, ey]]);
        [x, y] = [ex, ey];
        break;
      }
      case 'z':
        out.push(['Z', []]);
        [x, y] = [startX, startY];
        break;
    }
    lastCubic = cubic;
    lastQuad = quad;
  }
  return out;
}

/** An element's path, absolute and explicit, moved so the viewBox centre is the origin. */
function shiftPath(d) {
  return absolutize(parsePath(d))
    .map(([command, args]) => {
      const numbers = args.map((n, k) => {
        if (command === 'A') {
          if (k === 2 || k === 3 || k === 4) return String(n);
          if (k < 2) return fmt(n);
        }
        return fmt(n + SHIFT);
      });
      return `${command}${numbers.join(' ')}`;
    })
    .join('');
}

const s = n => fmt(Number(n) + SHIFT);
const num = n => Number(n ?? 0);

function elementToPath([kind, a]) {
  switch (kind) {
    case 'path':
      return shiftPath(a.d);
    case 'circle':
    case 'ellipse': {
      const rx = num(a.rx ?? a.r);
      const ry = num(a.ry ?? a.r);
      const cx = num(a.cx);
      const cy = num(a.cy);
      return `M${s(cx - rx)} ${s(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${s(cx + rx)} ${s(cy)}A${fmt(rx)} ${fmt(ry)} 0 1 0 ${s(cx - rx)} ${s(cy)}Z`;
    }
    case 'rect': {
      const x = num(a.x);
      const y = num(a.y);
      const w = num(a.width);
      const h = num(a.height);
      const rx = Math.min(num(a.rx ?? a.ry), w / 2);
      const ry = Math.min(num(a.ry ?? a.rx), h / 2);
      if (!rx && !ry) {
        return `M${s(x)} ${s(y)}H${s(x + w)}V${s(y + h)}H${s(x)}Z`;
      }
      const r = `${fmt(rx)} ${fmt(ry)} 0 0 1`;
      return (
        `M${s(x + rx)} ${s(y)}H${s(x + w - rx)}A${r} ${s(x + w)} ${s(y + ry)}` +
        `V${s(y + h - ry)}A${r} ${s(x + w - rx)} ${s(y + h)}H${s(x + rx)}` +
        `A${r} ${s(x)} ${s(y + h - ry)}V${s(y + ry)}A${r} ${s(x + rx)} ${s(y)}Z`
      );
    }
    case 'line':
      return `M${s(num(a.x1))} ${s(num(a.y1))}L${s(num(a.x2))} ${s(num(a.y2))}`;
    case 'polyline':
    case 'polygon': {
      const pts = a.points
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      let d = '';
      for (let k = 0; k < pts.length; k += 2) {
        d += `${k === 0 ? 'M' : 'L'}${s(pts[k])} ${s(pts[k + 1])}`;
      }
      return kind === 'polygon' ? `${d}Z` : d;
    }
    default:
      throw new Error(`unknown element ${kind}`);
  }
}

const icons = {};
for (const [name, elements] of Object.entries(nodes)) {
  icons[name] = {
    d: elements.map(elementToPath).join(''),
    tags: tags[name] ?? [],
  };
}
fs.mkdirSync(OUT, {recursive: true});
fs.writeFileSync(
  path.join(OUT, 'icons-lucide.json'),
  JSON.stringify({source: 'lucide-static', version, viewBox: 24, icons}),
);
fs.copyFileSync(
  path.join(source, 'LICENSE'),
  path.join(OUT, 'LICENSE-lucide.txt'),
);
console.log(`wrote ${Object.keys(icons).length} icons`);
