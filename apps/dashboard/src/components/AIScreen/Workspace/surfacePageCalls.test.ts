import { beforeEach, describe, expect, it, vi } from 'vitest';

const targets = vi.hoisted(() => ({
  workspace: null as unknown,
  sdlc: null as unknown,
  framePosts: 0,
  executed: [] as Array<{ tool: string; target: unknown }>,
  shownConversation: null as string | null,
}));

vi.mock('./workspaceBrowserTools', () => ({
  OTHER_CONVERSATION: 'other conversation',
  otherConversationShown: (id: unknown): boolean =>
    typeof id === 'string' &&
    id !== '' &&
    targets.shownConversation !== null &&
    targets.shownConversation !== id,
  runExclusive: <T>(task: () => Promise<T>): Promise<T> => task(),
  getWorkspaceWebview: () => targets.workspace,
  executePageTool: vi.fn((tool: string, _args: unknown, target?: unknown) => {
    targets.executed.push({ tool, target: target === undefined ? 'workspace' : target });
    return Promise.resolve({ ok: true, content: `ran ${tool}` });
  }),
}));

vi.mock('./sdlcBrowserTarget', () => ({
  getSdlcWebview: () => targets.sdlc,
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
    targets.sdlc = null;
    targets.framePosts = 0;
    targets.executed.length = 0;
    targets.shownConversation = null;
  });

  it('strips the routing fields the server adds', () => {
    expect(
      splitSurfaceArgs({
        ref: 'e1',
        xyneSurface: 'sdlc',
        xyneRunId: 'r1',
        xyneConversationId: 'c1',
      }),
    ).toEqual({
      surface: 'sdlc',
      runId: 'r1',
      conversationId: 'c1',
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

  it('opens a URL in the Xyne AI panel once it appears', async () => {
    const wv = webview();
    setTimeout(() => {
      targets.workspace = wv;
    }, 50);
    const result = await runSurfacePageCall('open-url', {
      url: 'https://docs.google.com/',
      xyneSurface: 'xyne-ai',
    });
    expect(wv.loadURL).toHaveBeenCalledWith('https://docs.google.com/');
    expect(result.ok).toBe(true);
  });

  it('rejects non-http URLs', async () => {
    const result = await runSurfacePageCall('open-url', {
      url: 'file:///etc/passwd',
      xyneSurface: 'xyne-ai',
    });
    expect(result.ok).toBe(false);
  });
});
