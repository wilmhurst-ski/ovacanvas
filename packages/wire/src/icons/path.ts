/**
 * SVG path data, parsed, made explicit, and re-written with a scale and an
 * offset baked in.
 *
 * @remarks
 * Icons are drawn at many sizes. Baking the size into the path data, rather
 * than scaling the node, keeps the stroke a fixed number of pixels at every
 * size, makes the node's bounds exactly what is drawn (so the audit measures
 * the icon, not a scaled box), and lets `end` trace an icon on in pixels.
 *
 * Output uses absolute M, L, C, Q, A and Z only, every number written out
 * separately. The engine's path code has gaps a browser does not - compact
 * arc flags ("0 00-2.4") misparse, a smooth curve right after a move takes
 * the wrong control point, radii too small to span an arc (even by a
 * rounding error) are not scaled up, and a relative move reads from wherever
 * the previous shape ended - and explicit absolute commands avoid them all.
 */
type Command = [string, number[]];

const COUNTS: Readonly<Record<string, number>> = {
  m: 2,
  l: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  t: 2,
  a: 7,
  z: 0,
};

export function parsePath(d: string): Command[] {
  const out: Command[] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i])) i++;
  };
  const number = (): number => {
    skip();
    const m = d.slice(i).match(/^[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/);
    if (!m) throw new Error(`bad number at ${i} in "${d}"`);
    i += m[0].length;
    return Number(m[0]);
  };
  const flag = (): number => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') {
      throw new Error(`bad arc flag at ${i} in "${d}"`);
    }
    i++;
    return Number(c);
  };
  let command: string | null = null;
  for (;;) {
    skip();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) command = d[i++];
    else if (!command) throw new Error(`no command at ${i} in "${d}"`);
    const lower = command.toLowerCase();
    if (!(lower in COUNTS)) throw new Error(`unknown command ${command}`);
    if (lower === 'z') {
      out.push([command, []]);
      command = null;
      continue;
    }
    const args: number[] = [];
    for (let k = 0; k < COUNTS[lower]; k++) {
      args.push(lower === 'a' && (k === 3 || k === 4) ? flag() : number());
    }
    out.push([command, args]);
    if (command === 'M') command = 'L';
    else if (command === 'm') command = 'l';
  }
  return out;
}

/** The same path in absolute M, L, C, Q, A, Z (smooth curves expanded). */
export function absolutePath(parts: readonly Command[]): Command[] {
  const out: Command[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let lastCubic: [number, number] | null = null;
  let lastQuad: [number, number] | null = null;
  for (const [command, args] of parts) {
    const lower = command.toLowerCase();
    const rel = command === lower;
    const px = (v: number) => (rel ? x + v : v);
    const py = (v: number) => (rel ? y + v : v);
    let cubic: [number, number] | null = null;
    let quad: [number, number] | null = null;
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
      case 'c':
      case 's': {
        const first: [number, number] =
          lower === 'c'
            ? [px(args[0]), py(args[1])]
            : lastCubic
              ? [2 * x - lastCubic[0], 2 * y - lastCubic[1]]
              : [x, y];
        const rest = lower === 'c' ? args.slice(2) : args;
        const c = [
          ...first,
          px(rest[0]),
          py(rest[1]),
          px(rest[2]),
          py(rest[3]),
        ];
        out.push(['C', c]);
        cubic = [c[2], c[3]];
        [x, y] = [c[4], c[5]];
        break;
      }
      case 'q':
      case 't': {
        const control: [number, number] =
          lower === 'q'
            ? [px(args[0]), py(args[1])]
            : lastQuad
              ? [2 * x - lastQuad[0], 2 * y - lastQuad[1]]
              : [x, y];
        const rest = lower === 'q' ? args.slice(2) : args;
        const q = [...control, px(rest[0]), py(rest[1])];
        out.push(['Q', q]);
        quad = control;
        [x, y] = [q[2], q[3]];
        break;
      }
      case 'a': {
        const ex = px(args[5]);
        const ey = py(args[6]);
        out.push(['A', [args[0], args[1], args[2], args[3], args[4], ex, ey]]);
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

function fmt(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
}

/**
 * The same path, scaled about the origin and then moved by (dx, dy), in
 * explicit absolute commands with every arc able to reach its end.
 */
export function transformPath(
  d: string,
  scale: number,
  dx = 0,
  dy = 0,
): string {
  const X = (v: number) => Math.round((v * scale + dx) * 100) / 100;
  const Y = (v: number) => Math.round((v * scale + dy) * 100) / 100;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  return absolutePath(parsePath(d))
    .map(([command, args]) => {
      if (command === 'Z') {
        [x, y] = [startX, startY];
        return 'Z';
      }
      if (command === 'A') {
        const ex = X(args[5]);
        const ey = Y(args[6]);
        let rx = Math.abs(args[0] * scale);
        let ry = Math.abs(args[1] * scale);
        // Radii too small to reach the end point - even by a rounding
        // error - are scaled up, as SVG does (F.6.6); the engine does not.
        const phi = (args[2] * Math.PI) / 180;
        const hx = (x - ex) / 2;
        const hy = (y - ey) / 2;
        const x1 = Math.cos(phi) * hx + Math.sin(phi) * hy;
        const y1 = -Math.sin(phi) * hx + Math.cos(phi) * hy;
        const lambda =
          rx && ry ? (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry) : 0;
        if (lambda > 0.9999) {
          const grow = Math.sqrt(lambda) * 1.001;
          rx *= grow;
          ry *= grow;
        }
        [x, y] = [ex, ey];
        return `A${fmt(rx)} ${fmt(ry)} ${args[2]} ${args[3]} ${args[4]} ${ex} ${ey}`;
      }
      const numbers: number[] = [];
      for (let k = 0; k < args.length; k += 2) {
        numbers.push(X(args[k]), Y(args[k + 1]));
      }
      [x, y] = [numbers[numbers.length - 2], numbers[numbers.length - 1]];
      if (command === 'M') [startX, startY] = [x, y];
      return `${command}${numbers.join(' ')}`;
    })
    .join('');
}
