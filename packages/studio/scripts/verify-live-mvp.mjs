/**
 * Drive the running MVP in a real browser and prove a question becomes a
 * visible, audited beat.
 *
 * @remarks
 * Start the dev server first (`npm run studio:dev`), then:
 *   node packages/studio/scripts/verify-live-mvp.mjs "your question"
 *
 * This is deliberately a real browser against the real dev server rather than
 * a unit test: the claim being checked is that a learner typing a question
 * ends up looking at a rendered canvas, and only a browser can answer that.
 */
import {chromium} from 'playwright';

const url = process.env.MVP_URL ?? 'http://127.0.0.1:5273';
const question =
  process.argv[2] ?? 'why does a derivative measure a rate of change';
const screenshot = process.argv[3] ?? 'mvp-verification.png';

const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport: {width: 1280, height: 900}});

const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
});

try {
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(
    () => {
      const status = document.getElementById('status');
      return status && status.textContent && status.textContent.trim().length > 0;
    },
    undefined,
    {timeout: 30000},
  );
  console.log('HEALTH', await page.textContent('#status'));

  await page.fill('#question', question);
  await page.click('#ask-button');
  console.log('ASKED', question);

  await page.waitForFunction(
    () => document.getElementById('status').textContent.includes('On screen.'),
    undefined,
    {timeout: 240000},
  );

  const result = await page.evaluate(() => ({
    status: document.getElementById('status').textContent,
    meta: document.getElementById('meta').textContent,
    canvases: document.querySelectorAll('.stage canvas').length,
    beats: [...document.querySelectorAll('.stage .ovc-beat')].map(
      element => element.dataset.beat,
    ),
  }));

  // A canvas that actually has ink on it, not just a mounted element. The
  // beat plays on a loop and may legitimately fade out mid-cycle, so this
  // polls rather than sampling one instant - "draws nothing right now" is not
  // the same claim as "draws nothing".
  let hasInk = false;
  for (let attempt = 0; attempt < 20 && !hasInk; attempt++) {
    hasInk = await page.evaluate(() => {
      const canvas = document.querySelector('.stage canvas');
      if (!canvas) return false;
      const context = canvas.getContext('2d');
      const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
      const distinct = new Set();
      for (let index = 0; index < data.length; index += 4 * 997) {
        distinct.add(`${data[index]},${data[index + 1]},${data[index + 2]}`);
        if (distinct.size > 4) return true;
      }
      return distinct.size > 1;
    });
    if (!hasInk) await page.waitForTimeout(200);
  }

  await page.screenshot({path: screenshot, fullPage: false});

  console.log('RESULT', JSON.stringify({...result, hasInk, pageErrors}, null, 2));
  process.exitCode = result.canvases > 0 && hasInk && pageErrors.length === 0 ? 0 : 1;
} catch (error) {
  console.log('FAILED', error.message);
  console.log('STATUS', await page.textContent('#status').catch(() => '?'));
  console.log('PAGE ERRORS', JSON.stringify(pageErrors, null, 2));
  await page.screenshot({path: screenshot}).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
