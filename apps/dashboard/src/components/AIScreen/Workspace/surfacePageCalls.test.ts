import { beforeEach, describe, expect, it, vi } from 'vitest';

const targets = vi.hoisted(() => ({
  workspace: null as unknown,
  /** The workspace's tabs: each its page, and where it was opened. */
  tabs: new Map<string, { url: string; view: unknown }>(),
  sdlc: null as unknown,
  framePosts: 0,
  /** Who hears the workspace's pages and the SDLC browser change. */
  listeners: new Set<() => void>(),
  changed(): void {
    this.listeners.forEach(listener => listener());
  },
  executed: [] as Array<{ tool: string; target: unknown }>,
}));

vi.mock('./workspaceBrowserTools', () => ({
  getWorkspaceWebview: () => targets.workspace,
  workspaceTabAt: (url: string) =>
    [...targets.tabs].find(([, tab]) => tab.url === url)?.[0] ?? null,
  workspacePage: (tab: string) => targets.tabs.get(tab)?.view ?? null,
  subscribeToWorkspacePages: (listener: () => void) => {
    targets.listeners.add(listener);
    return () => targets.listeners.delete(listener);
  },
  executePageTool: vi.fn((tool: string, _args: unknown, target?: unknown) => {
    targets.executed.push({ tool, target: target === undefined ? 'workspace' : target });
    return Promise.resolve({ ok: true, content: `ran ${tool}` });
  }),
}));

vi.mock('./sdlcBrowserTarget', () => ({
  getSdlcWebview: () => targets.sdlc,
  subscribeToSdlcWebview: (listener: () => void) => {
    targets.listeners.add(listener);
    return () => targets.listeners.delete(listener);
  },
  requestSdlcBrowser: () => {
    targets.framePosts += 1;
    return true;
  },
}));

import { runSurfacePageCall, splitSurfaceArgs } from './surfacePageCalls';

const webview = (url = 'about:blank') => ({
  getURL: () => url,
  loadURL: vi.fn(() => Promise.resolve()),
});

describe('surface page calls', () => {
  beforeEach(() => {
    targets.workspace = null;
    targets.tabs.clear();
    targets.sdlc = null;
    targets.framePosts = 0;
    targets.listeners.clear();
    targets.executed.length = 0;
  });

  it('strips the routing fields the server adds', () => {
    expect(splitSurfaceArgs({ ref: 'e1', xyneSurface: 'sdlc', xyneRunId: 'r1' })).toEqual({
      surface: 'sdlc',
      runId: 'r1',
      args: { ref: 'e1' },
    });
    expect(splitSurfaceArgs({ ref: 'e1' }).surface).toBe('xyne-ai');
  });

  it('runs SDLC page tools against the SDLC browser', async () => {
    targets.sdlc = webview();
    await runSurfacePageCall('page-click', {
      ref: 'e1',
      xyneSurface: 'sdlc',
      xyneRunId: 'run-yes',
    });
    expect(targets.executed).toEqual([{ tool: 'page-click', target: targets.sdlc }]);
  });

  it('runs Xyne AI page tools against the workspace panel', async () => {
    await runSurfacePageCall('page-read', { xyneSurface: 'xyne-ai', xyneRunId: 'run-ai' });
    expect(targets.executed).toEqual([{ tool: 'page-read', target: 'workspace' }]);
  });

  it('opens a URL in the SDLC browser, asking the lane to show it first', async () => {
    const wv = webview();
    setTimeout(() => {
      targets.sdlc = wv;
      targets.changed();
    }, 50);
    const result = await runSurfacePageCall('open-url', {
      url: 'https://docs.google.com/',
      xyneSurface: 'sdlc',
      xyneRunId: 'run-open',
    });
    expect(targets.framePosts).toBe(1);
    expect(wv.loadURL).toHaveBeenCalledWith('https://docs.google.com/');
    expect(result.ok).toBe(true);
  });

  it('opens a URL in the Xyne AI panel tab added for it, leaving the shown tab be', async () => {
    const shown = webview('https://example.com/');
    targets.workspace = shown;
    targets.tabs.set('tab-shown', { url: 'https://example.com/', view: shown });
    const added = webview();
    setTimeout(() => {
      targets.tabs.set('tab-new', { url: 'https://docs.google.com/', view: added });
      targets.changed();
    }, 50);
    const result = await runSurfacePageCall('open-url', {
      url: 'https://docs.google.com/',
      xyneSurface: 'xyne-ai',
    });
    expect(added.loadURL).toHaveBeenCalledWith('https://docs.google.com/');
    expect(shown.loadURL).not.toHaveBeenCalled();
    expect(result.content).toContain('tab-new');
  });

  it('points at the Xyne AI panel tab already at a URL instead of opening it again', async () => {
    const open = webview('https://docs.google.com/');
    targets.tabs.set('tab-open', { url: 'https://docs.google.com/', view: open });
    const result = await runSurfacePageCall('open-url', {
      url: 'https://docs.google.com/',
      xyneSurface: 'xyne-ai',
    });
    expect(open.loadURL).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.content).toContain('tab-open');
  });

  it('rejects non-http URLs', async () => {
    const result = await runSurfacePageCall('open-url', {
      url: 'file:///etc/passwd',
      xyneSurface: 'xyne-ai',
    });
    expect(result.ok).toBe(false);
  });
});
