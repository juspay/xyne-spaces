import {
  executePageTool,
  getWorkspaceWebview,
  subscribeToWorkspacePages,
  workspacePage,
  workspaceTabAt,
  workspaceTabOpenedFor,
  type PageToolResult,
} from './workspaceBrowserTools';
import { getSdlcWebview, requestSdlcBrowser, subscribeToSdlcWebview } from './sdlcBrowserTarget';
import type { ElectronWebviewElement } from '../../../types/electron';

export type BrowserSurface = 'xyne-ai' | 'sdlc';

const OPEN_URL_TOOL = 'open-url';
const WAIT_FOR_BROWSER_MS = 12_000;
const SETTLE_MS = 800;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * What `read` gives, once it gives something: read now, and again each time
 * `subscribe` says things changed — null if nothing comes within `ms`.
 */
function whenReady<T>(
  read: () => T | null,
  subscribe: (listener: () => void) => () => void,
  ms: number,
): Promise<T | null> {
  const now = read();
  if (now) return Promise.resolve(now);
  return new Promise(resolve => {
    let unsubscribe = (): void => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, ms);
    unsubscribe = subscribe(() => {
      const value = read();
      if (!value) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(value);
    });
  });
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function splitSurfaceArgs(raw: Record<string, unknown>): {
  surface: BrowserSurface;
  runId: string;
  args: Record<string, unknown>;
} {
  const { xyneSurface, xyneRunId, ...args } = raw;
  return {
    surface: xyneSurface === 'sdlc' ? 'sdlc' : 'xyne-ai',
    runId: typeof xyneRunId === 'string' ? xyneRunId : '',
    args,
  };
}

async function load(wv: ElectronWebviewElement, url: string): Promise<void> {
  let current = '';
  try {
    current = wv.getURL();
  } catch {
    current = '';
  }
  if (current !== url) {
    await Promise.resolve(wv.loadURL(url)).catch(() => undefined);
  }
  await delay(SETTLE_MS);
}

async function openUrl(
  surface: BrowserSurface,
  args: Record<string, unknown>,
): Promise<PageToolResult> {
  const url = httpUrl(args['url']);
  if (!url) return { ok: false, content: 'open-url needs an absolute http or https URL.' };

  if (surface === 'sdlc') {
    if (!getSdlcWebview() && !requestSdlcBrowser()) {
      return {
        ok: false,
        content: 'The SDLC screen is not open in the Xyne app, so there is no browser to use.',
      };
    }
    const wv = await whenReady(getSdlcWebview, subscribeToSdlcWebview, WAIT_FOR_BROWSER_MS);
    if (!wv) {
      return {
        ok: false,
        content:
          'Ask the user to open a folder in the SDLC hub so its browser is available, then try again.',
      };
    }
    await load(wv, url);
    return {
      ok: true,
      content: `Opened ${url} in the browser in the user's SDLC screen. Use page-snapshot, page-read, page-click and page-type to work with it.`,
    };
  }

  const opened = (tab: string): PageToolResult => ({
    ok: true,
    content: `Opened ${url} in tab ${tab} of the browser panel beside the Xyne AI chat. Pass tab ${tab} to page-snapshot, page-read, page-click and page-type to work with it.`,
  });
  // Showing it already: that tab, as it is.
  const showing = workspaceTabAt(url);
  if (showing) {
    return {
      ok: true,
      content: `${url} is already open in tab ${showing} of the browser panel beside the Xyne AI chat. Pass tab ${showing} to page-snapshot, page-read, page-click and page-type to work with it.`,
    };
  }
  // Its tab is open but has gone elsewhere since: back to it, in that tab.
  const moved = workspaceTabOpenedFor(url);
  const movedPage = moved ? workspacePage(moved) : null;
  if (moved && movedPage) {
    await load(movedPage, url);
    return opened(moved);
  }
  // The server added it as a new tab, which starts at the address: once it opens,
  // that tab — not loaded a second time, which would cut its first load short.
  const tab = await whenReady(
    () => workspaceTabOpenedFor(url),
    subscribeToWorkspacePages,
    WAIT_FOR_BROWSER_MS,
  );
  if (tab) return opened(tab);
  // A server from before tabs: the page on screen, as then.
  const wv = getWorkspaceWebview();
  if (!wv) {
    return { ok: false, content: 'The Xyne AI screen did not open its browser panel.' };
  }
  await load(wv, url);
  return {
    ok: true,
    content: `Opened ${url} in the browser panel beside the Xyne AI chat. Use page-snapshot, page-read, page-click and page-type to work with it.`,
  };
}

export async function runSurfacePageCall(
  toolName: string,
  rawArgs: Record<string, unknown>,
): Promise<PageToolResult> {
  const { surface, args } = splitSurfaceArgs(rawArgs);
  if (toolName === OPEN_URL_TOOL) return openUrl(surface, args);
  if (!toolName.startsWith('page-'))
    return { ok: false, content: `Unknown browser tool ${toolName}` };
  if (surface === 'sdlc') {
    const wv = getSdlcWebview();
    if (!wv) return { ok: false, content: 'No SDLC browser is open. Call open-url first.' };
    return executePageTool(toolName, args, wv);
  }
  return executePageTool(toolName, args);
}
