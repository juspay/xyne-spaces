import { executePageTool, getWorkspaceWebview, type PageToolResult } from './workspaceBrowserTools';
import { getSdlcWebview, requestSdlcBrowser } from './sdlcBrowserTarget';
import type { ElectronWebviewElement } from '../../../types/electron';

export type BrowserSurface = 'xyne-ai' | 'sdlc';

const OPEN_URL_TOOL = 'open-url';
const WAIT_FOR_BROWSER_MS = 12_000;
const WAIT_STEP_MS = 200;
const SETTLE_MS = 800;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor<T>(read: () => T | null, ms: number): Promise<T | null> {
  const until = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() >= until) return null;
    await delay(WAIT_STEP_MS);
  }
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
    const wv = await waitFor(getSdlcWebview, WAIT_FOR_BROWSER_MS);
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

  const wv = await waitFor(getWorkspaceWebview, WAIT_FOR_BROWSER_MS);
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
