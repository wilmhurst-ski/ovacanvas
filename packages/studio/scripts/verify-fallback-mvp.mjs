/**
 * Prove the product's core promise in a real browser: a learner who asks a
 * question always ends up looking at a rendered beat, even when authoring
 * fails.
 *
 * @remarks
 * Start the dev server first (`npm run studio:dev`), then:
 *   node packages/studio/scripts/verify-fallback-mvp.mjs
 *
 * The other live script checks the happy path and needs a provider. This one
 * checks the promise that matters more, and it needs nothing: with no usable
 * provider the authoring call fails, and the host-authored fallback must be on
 * screen anyway. An exhausted quota is not a failure condition for this check -
 * it is the condition being tested.
 */
import {chromium} from 'playwright';

const url = process.env.MVP_URL ?? 'http://127.0.0.1:5273';
const question =
  process.argv[2] ?? 'explain why the sky is blue in the morning';
const screenshot = process.argv[3] ?? 'mvp-fallback.png';

const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport: {width: 1280, height: 900}});

const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') pageErrors.push(`console: ${message.text()}`);
});

/** Ink on the stage canvas, sampled rather than taken from one instant. */
const inkOnCanvas = () =>
  page.evaluate(() => {
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

try {
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(
    () => document.getElementById('status')?.textContent?.trim().length > 0,
    undefined,
    {timeout: 30000},
  );

  await page.fill('#question', question);
  await page.click('#ask-button');

  // Wait for it to START working first. Without this the "stopped working"
  // wait below is satisfied by the idle state before the click registers, and
  // the whole check passes without the app having done anything - which is
  // exactly what happened on the first run of this script.
  await page.waitForFunction(
    () => document.getElementById('dot')?.dataset.state === 'working',
    undefined,
    {timeout: 30000, polling: 100},
  );

  // Then wait for it to stop, whichever way it resolves.
  await page.waitForFunction(
    () => document.getElementById('dot')?.dataset.state !== 'working',
    undefined,
    {timeout: 300000, polling: 500},
  );

  const state = await page.getAttribute('#dot', 'data-state');
  const status = (await page.textContent('#status')) ?? '';
  const detail = (await page.textContent('#meta')) ?? '';
  console.log('STATE', state);
  console.log('STATUS', status.trim(), '|', detail.trim());

  // The claim: there is a beat on screen regardless of how authoring went.
  let hasInk = false;
  for (let attempt = 0; attempt < 25 && !hasInk; attempt++) {
    hasInk = await inkOnCanvas();
    if (!hasInk) await page.waitForTimeout(200);
  }

  const canvases = await page.locator('.stage canvas').count();
  await page.screenshot({path: screenshot});

  console.log('CANVASES', canvases);
  console.log('INK', hasInk);
  console.log('PAGE ERRORS', JSON.stringify(pageErrors));

  // Ink alone is weak evidence - the stage canvas exists and has pixels even
  // when it holds no beat. The status is the real signal: it must say a beat
  // is on screen, and the app must not be reporting a bare error.
  const explained = /on screen/i.test(detail) || /on screen/i.test(status);
  if (!hasInk || canvases < 1 || !explained) {
    console.error(
      `FAIL the learner was left without an explanation ` +
        `(canvases=${canvases} ink=${hasInk} state=${state})`,
    );
    process.exitCode = 1;
  } else {
    console.log('PASS a beat is on screen, and the app says so');
  }
} catch (error) {
  console.error('FAILED', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
