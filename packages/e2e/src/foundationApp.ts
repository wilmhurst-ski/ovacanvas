import * as path from 'path';
import {Browser, Page, chromium} from 'playwright';
import {fileURLToPath} from 'url';
import {ViteDevServer, createServer} from 'vite';

const Root = fileURLToPath(new URL('.', import.meta.url));

export interface FoundationApp {
  page: Page;
  browser: Browser;
  server: ViteDevServer;
  pageErrors: string[];
  consoleErrors: string[];
  stop: () => Promise<void>;
}

/**
 * Boots the foundation regression page against a real Vite dev server, the
 * same way the OVC-A003 / A003R probes did.
 */
export async function startFoundation(
  page = '/foundation.html',
): Promise<FoundationApp> {
  const [browser, server] = await Promise.all([
    launchChromium(),
    createServer({
      root: Root,
      configFile: path.resolve(Root, '../vite.config.ts'),
    }).then(server => server.listen()),
  ]);

  const browserPage = await browser.newPage({
    viewport: {width: 1100, height: 760},
  });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  browserPage.on('pageerror', error => pageErrors.push(String(error)));
  browserPage.on('console', message => {
    if (message.type() !== 'error') return;
    // The source URL is appended because a failed resource load reports only
    // "Failed to load resource: the server responded with a status of 404" -
    // with no URL, that is indistinguishable between a missing favicon and a
    // missing asset, and a guard that cannot tell them apart has to either
    // ignore both or fail on both.
    const {url} = message.location();
    consoleErrors.push(url ? `${message.text()} @ ${url}` : message.text());
  });

  await browserPage.goto(
    `http://localhost:${server.config.server.port}${page}`,
  );

  return {
    page: browserPage,
    browser,
    server,
    pageErrors,
    consoleErrors,
    async stop() {
      await Promise.all([browser.close(), server.close()]);
    },
  };
}

/**
 * The golden foundation replay was recorded on headless Chrome
 * (`channel: 'chrome'`), so that is the default. CI images that ship only the
 * bundled Chromium fall back to it; `OVC_BROWSER_CHANNEL` overrides both.
 */
async function launchChromium(): Promise<Browser> {
  const channel = process.env.OVC_BROWSER_CHANNEL ?? 'chrome';
  try {
    return await chromium.launch({headless: true, channel});
  } catch {
    return await chromium.launch({headless: true});
  }
}
