/**
 * Check every converted icon against the original, drawn by the browser.
 *
 * Usage: node scripts/check-icons.mjs <lucide-static dir> [limit]
 *
 * For each icon, headless Chromium draws the original SVG file (the
 * reference: the browser implements SVG to the letter) and the converted
 * path through the engine's own path code (`getPathProfile` and each
 * segment's `draw`, exactly what a Path node renders). The two are compared
 * pixel by pixel and the icons that differ most are listed. This is how the
 * joined-relative-move and small-arc-radius conversion bugs were found and
 * shown fixed across all of them, not just the ones someone looked at.
 */
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';

const source = process.argv[2];
const limit = Number(process.argv[3] ?? 25);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW = path.resolve(HERE, '../preview');
const PROFILE = path
  .resolve(HERE, '../../2d/lib/curves/getPathProfile.js')
  .replace(/\\/g, '/');
const data = JSON.parse(
  fs.readFileSync(path.resolve(HERE, '../data/icons-lucide.json'), 'utf8'),
);

const vite = await import('vite');
const server = await vite.createServer({
  configFile: path.join(PREVIEW, 'vite.config.ts'),
  root: PREVIEW,
  logLevel: 'error',
  server: {host: '127.0.0.1', port: 0},
});
await server.listen();
const {chromium} = await import('playwright');
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto(server.resolvedUrls.local[0]);
  const names = Object.keys(data.icons);
  const results = [];
  for (let i = 0; i < names.length; i += 100) {
    const batch = names.slice(i, i + 100).map(name => ({
      name,
      d: data.icons[name].d,
      svg: fs.readFileSync(path.join(source, 'icons', `${name}.svg`), 'utf8'),
    }));
    results.push(
      ...(await page.evaluate(
        async ({batch, profileUrl}) => {
          const {getPathProfile} = await import(profileUrl);
          const SIZE = 96;
          const draw = () => {
            const c = document.createElement('canvas');
            c.width = SIZE;
            c.height = SIZE;
            return c;
          };
          const pixels = c =>
            c.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
          const out = [];
          for (const {name, d, svg} of batch) {
            // Reference: the SVG file, black strokes, drawn by the browser.
            const ref = draw();
            const image = new Image();
            image.src = `data:image/svg+xml;base64,${btoa(
              svg.replace(/currentColor/g, '#000'),
            )}`;
            await image.decode();
            ref.getContext('2d').drawImage(image, 0, 0, SIZE, SIZE);
            // Candidate: the converted path through the engine's profile.
            const mine = draw();
            const context = mine.getContext('2d');
            context.translate(SIZE / 2, SIZE / 2);
            context.scale(SIZE / 24, SIZE / 24);
            const path2d = new Path2D();
            let last = null;
            for (const segment of getPathProfile(d).segments) {
              const start = segment.getPoint(0).position;
              const move = !last || !start.equals(last);
              const [, end] = segment.draw(path2d, 0, 1, move);
              last = end.position;
            }
            context.lineWidth = 2;
            context.lineCap = 'round';
            context.lineJoin = 'round';
            context.strokeStyle = '#000';
            context.stroke(path2d);
            const a = pixels(ref);
            const b = pixels(mine);
            let differ = 0;
            let inked = 0;
            for (let p = 3; p < a.length; p += 4) {
              if (a[p] > 128 || b[p] > 128) inked++;
              if (a[p] > 128 !== b[p] > 128) differ++;
            }
            out.push({name, difference: inked ? differ / inked : 0});
          }
          return out;
        },
        {batch, profileUrl: `/@fs/${PROFILE}`},
      )),
    );
  }
  results.sort((x, y) => y.difference - x.difference);
  const bad = results.filter(r => r.difference > 0.15);
  console.log(
    `${results.length} icons checked; ${bad.length} differ from the original by more than 15% of their ink`,
  );
  for (const r of results.slice(0, limit)) {
    console.log(`${r.name.padEnd(28)} ${(r.difference * 100).toFixed(1)}%`);
  }
} finally {
  await browser.close();
  await server.close();
}
