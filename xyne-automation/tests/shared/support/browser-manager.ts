import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type BrowserType,
  chromium,
  firefox,
  type Page,
  request,
  webkit,
} from '@playwright/test';
import { config } from '@/config';
import { gaugeLogger } from '@/lib/logger';
import { type BrowserSession, testContext } from '@/tests/shared/runtime/test-context';
import { ZERO_SYNC_BRIDGE_SCRIPT } from '@/tests/shared/support/zero-sync-bridge';

type SupportedBrowser = 'chromium' | 'firefox' | 'webkit';
type SupportedBrowserChannel = SupportedBrowser | 'chrome';

interface BrowserPoolEntry {
  browser: Browser;
  browserType: SupportedBrowserChannel;
  inUse: boolean;
}

const browserTypes: Record<SupportedBrowser, BrowserType> = {
  chromium,
  firefox,
  webkit,
};
const browserPool: BrowserPoolEntry[] = [];
const MAIN_BROWSER_NAME = 'default-browser-1';

export function isMainSession(sessionName: string): boolean {
  return sessionName === MAIN_BROWSER_NAME;
}

async function acquireBrowserEntry(
  browserTypeName: SupportedBrowserChannel
): Promise<BrowserPoolEntry> {
  const availableEntry = browserPool.find(
    (entry) => !entry.inUse && entry.browserType === browserTypeName
  );

  if (availableEntry) {
    if (!availableEntry.browser.isConnected()) {
      gaugeLogger.warn('Removing dead browser from pool', { browserType: browserTypeName });
      await availableEntry.browser.close().catch(() => {});
      browserPool.splice(browserPool.indexOf(availableEntry), 1);
    } else {
      availableEntry.inUse = true;
      gaugeLogger.info('Reusing idle browser from pool', { browserType: browserTypeName });
      return availableEntry;
    }
  }

  const browserLauncher = browserTypeName === 'chrome' ? chromium : browserTypes[browserTypeName];

  const browser: Browser = await browserLauncher.launch({
    headless: config.headless,
    args: [
      '--disable-crash-reporter',
      '--disable-in-process-stack-traces',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      // Additional flags to prevent crashes
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--metrics-recording-only',
      '--disable-default-apps',
      '--mute-audio',
      '--no-first-run',
      '--disable-setuid-sandbox',
      '--disable-accelerated-2d-canvas',
      '--disable-web-security', // For test environment
      '--js-flags=--max-old-space-size=4096', // Increase V8 heap size
    ],
    ...(browserTypeName === 'chrome' ? { channel: 'chrome' } : {}),
  });

  const entry: BrowserPoolEntry = {
    browser,
    browserType: browserTypeName,
    inUse: true,
  };

  browserPool.push(entry);

  return entry;
}

async function buildSession(
  width: number,
  height: number,
  browserTypeName: SupportedBrowserChannel
): Promise<BrowserSession> {
  const entry = await acquireBrowserEntry(browserTypeName);

  const isChromium = browserTypeName === 'chromium' || browserTypeName === 'chrome';
  const context: BrowserContext = await entry.browser.newContext({
    viewport: {
      width,
      height,
    },
    baseURL: config.dashboard.baseUrl,
    ...(isChromium ? { permissions: ['microphone', 'camera'] } : {}),
  });

  context.setDefaultTimeout(config.timeout);

  // Inject the Zero sync bridge before any page script runs.
  // This monitors WebSocket activity so tests can deterministically
  // wait for Zero to finish syncing mutations to the backend.
  await context.addInitScript(ZERO_SYNC_BRIDGE_SCRIPT);

  const page: Page = await context.newPage();

  return {
    browser: entry.browser,
    context,
    page,
    browserType: browserTypeName,
    viewportWidth: width,
    viewportHeight: height,
  };
}

export async function ensureNamedBrowserSession(
  name: string,
  width: number,
  height: number,
  browserTypeName: SupportedBrowserChannel = 'chromium'
): Promise<void> {
  const existingSession = testContext.sessions.get(name);

  if (existingSession) {
    if (existingSession.viewportWidth !== width || existingSession.viewportHeight !== height) {
      await releaseSession(name);
      const session = await buildSession(width, height, browserTypeName);
      testContext.sessions.set(name, session);
      testContext.activeSessionName = name;
      return;
    }

    testContext.activeSessionName = name;
    return;
  }

  const session = await buildSession(width, height, browserTypeName);
  testContext.sessions.set(name, session);
  testContext.activeSessionName = name;
}

async function releaseBrowserIfIdle(browser: Browser): Promise<void> {
  const poolIndex = browserPool.findIndex((entry) => entry.browser === browser);
  if (poolIndex === -1) {
    return;
  }

  browserPool[poolIndex].inUse = false;

  const hasOtherContexts = browserPool[poolIndex].browser.contexts().length > 0;
  if (!hasOtherContexts) {
    await browserPool[poolIndex].browser.close();
    browserPool.splice(poolIndex, 1);
  }
}

async function releaseSession(name: string): Promise<void> {
  const session = testContext.sessions.get(name);
  if (!session) {
    return;
  }

  testContext.sessions.delete(name);
  await session.context.close();
  await releaseBrowserIfIdle(session.browser);
}

export async function ensureBrowserSession(
  width: number,
  height: number,
  browserTypeName: SupportedBrowserChannel = 'chromium'
): Promise<void> {
  const defaultName = MAIN_BROWSER_NAME;
  const existingSession = testContext.sessions.get(defaultName);

  if (existingSession) {
    if (existingSession.browserType !== browserTypeName) {
      throw new Error(
        `Active session uses "${existingSession.browserType}", but "${browserTypeName}" was requested. Release the current session first.`
      );
    }

    if (existingSession.viewportWidth !== width || existingSession.viewportHeight !== height) {
      await releaseSession(defaultName);
      const session = await buildSession(width, height, browserTypeName);
      testContext.sessions.set(defaultName, session);
      testContext.activeSessionName = defaultName;
      return;
    }

    testContext.activeSessionName = defaultName;
    return;
  }

  const session = await buildSession(width, height, browserTypeName);
  testContext.sessions.set(defaultName, session);
  testContext.activeSessionName = defaultName;
}

export async function releaseAllBrowserSessions(): Promise<void> {
  const entries = [...testContext.sessions.entries()];

  const browsersToRelease: Set<Browser> = new Set();
  for (const [, session] of entries) {
    await session.context.close();
    browsersToRelease.add(session.browser);
  }

  for (const browser of browsersToRelease) {
    await releaseBrowserIfIdle(browser);
  }

  testContext.sessions.clear();
  testContext.activeSessionName = null;
}

export async function resetAllBrowserSessionsForReuse(): Promise<void> {
  const entries = [...testContext.sessions.entries()];

  const browsersToKeepAlive: Set<Browser> = new Set();
  const browsersToClose: Set<Browser> = new Set();

  for (const [name, session] of entries) {
    await session.context.close().catch((error: unknown) => {
      gaugeLogger.warn('Failed to close context during session reset', {
        sessionName: name,
        error: String(error),
      });
    });

    if (isMainSession(name)) {
      browsersToKeepAlive.add(session.browser);
    } else {
      browsersToClose.add(session.browser);
    }
  }

  // Handle main browsers: keep alive in pool, check connectivity
  for (const browser of browsersToKeepAlive) {
    const poolIndex = browserPool.findIndex((entry) => entry.browser === browser);
    if (poolIndex === -1) continue;

    if (!browser.isConnected()) {
      gaugeLogger.warn('Removing dead main browser from pool', {
        browserType: browserPool[poolIndex].browserType,
      });
      await browser.close().catch(() => {});
      browserPool.splice(poolIndex, 1);
      continue;
    }

    browserPool[poolIndex].inUse = false;
  }

  // Handle temp browsers: close and remove from pool
  // IMPORTANT: Collect indices to splice in REVERSE order to avoid index shift
  const tempBrowserIndices: number[] = [];
  for (const browser of browsersToClose) {
    const poolIndex = browserPool.findIndex((entry) => entry.browser === browser);
    if (poolIndex !== -1) {
      const closedBrowserType = browserPool[poolIndex].browserType;
      await browser.close().catch(() => {});
      tempBrowserIndices.push(poolIndex);
      gaugeLogger.info('Closed temp browser and removed from pool', {
        browserType: closedBrowserType,
      });
    }
  }

  // Splice in reverse order to maintain correct indices
  for (const index of tempBrowserIndices.sort((a, b) => b - a)) {
    browserPool.splice(index, 1);
  }

  testContext.sessions.clear();
  testContext.activeSessionName = null;
}

export async function closeAllBrowserSessions(): Promise<void> {
  await releaseAllBrowserSessions();

  for (const entry of browserPool) {
    await entry.browser.close();
  }

  browserPool.length = 0;
}

export async function ensureApiRequestContext(): Promise<APIRequestContext> {
  if (testContext.apiRequestContext) {
    return testContext.apiRequestContext;
  }

  testContext.apiRequestContext = await request.newContext({
    baseURL: config.backend.baseUrl,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
  });

  return testContext.apiRequestContext;
}

export async function disposeApiRequestContext(): Promise<void> {
  if (!testContext.apiRequestContext) {
    return;
  }

  await testContext.apiRequestContext.dispose();
  testContext.apiRequestContext = null;
}
