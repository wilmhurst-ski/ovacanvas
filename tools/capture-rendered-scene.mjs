import * as fs from 'fs';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {chromium} from 'playwright';
import {compileBeatModule} from '../packages/host/lib/authoring/compileBeatModule.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const compileRoot = path.join(repoRoot, 'packages', 'host');
const sourcePath = path.join(repoRoot, 'packages', 'studio', 'scratch', 'what_causes_the_seasons_on_ear.ts');
const screenshotPath = 'C:\\Users\\WILMHURST\\.gemini\\antigravity-ide\\brain\\df86e3f1-9ceb-4b62-9eef-90f2f5929df7\\mvp-live-apmix-seasons.png';

console.log('Compiling authored beat from:', sourcePath);
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = compileBeatModule(source, compileRoot);

if (!compiled.ok) {
  console.error('Compilation failed:', compiled.diagnostics);
  process.exit(1);
}
console.log('Beat compiled successfully. Code length:', compiled.code.length);

const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport: {width: 1280, height: 900}});

page.on('console', msg => console.log(`[browser ${msg.type()}]`, msg.text()));
page.on('pageerror', err => console.error('[browser error]', err));

// Route /api/generate to return our compiled beat authored by gpt-5.6-luna-free
await page.route('**/api/generate', route => {
  console.log('Intercepted /api/generate, returning APMIX authored beat!');
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ok: true,
      strategy: 'full-code-gen',
      provider: 'apmix',
      model: 'gpt-5.6-luna-free',
      attempts: 1,
      repaired: false,
      source,
      code: compiled.code,
      usage: { promptTokens: 2086, completionTokens: 1885 },
      strategyReason: 'general code generation path',
    }),
  });
});

await page.goto('http://127.0.0.1:5273', {waitUntil: 'domcontentloaded'});
await page.waitForFunction(
  () => document.getElementById('status')?.textContent?.trim().length > 0,
  undefined,
  {timeout: 30000}
);

console.log('Submitting question: "what causes the seasons on Earth"');
await page.fill('#question', 'what causes the seasons on Earth');
await page.click('#ask-button');

let lastStatus = '';
const interval = setInterval(async () => {
  try {
    const s = await page.textContent('#status');
    if (s && s !== lastStatus) {
      lastStatus = s;
      console.log('PAGE STATUS:', s);
    }
  } catch {}
}, 500);

try {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('status');
      return el && (el.textContent.includes('On screen.') || el.textContent.includes('simpler version') || el.textContent.includes('refused'));
    },
    undefined,
    {timeout: 30000}
  );
} catch (e) {
  console.log('TIMED OUT. Final status:', await page.textContent('#status'));
  console.log('Final meta:', await page.textContent('#meta'));
  await page.screenshot({path: screenshotPath, fullPage: false});
  console.log('Saved debug screenshot to:', screenshotPath);
  throw e;
} finally {
  clearInterval(interval);
}

// Wait for animation loop to advance and ink to render
await page.waitForTimeout(2000);

// Check canvas ink
const hasInk = await page.evaluate(() => {
  const canvas = document.querySelector('.stage canvas');
  if (!canvas) return false;
  const context = canvas.getContext('2d');
  const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
  const distinct = new Set();
  for (let i = 0; i < data.length; i += 4 * 997) {
    distinct.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    if (distinct.size > 4) return true;
  }
  return distinct.size > 1;
});

const status = await page.textContent('#status');
const meta = await page.textContent('#meta');
console.log('CANVAS HAS INK:', hasInk);
console.log('STATUS:', status, '| META:', meta);

await page.screenshot({path: screenshotPath, fullPage: false});
console.log('Saved screenshot to:', screenshotPath);

await browser.close();
