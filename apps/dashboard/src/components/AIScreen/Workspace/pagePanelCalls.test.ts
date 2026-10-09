import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/XyneAI/XyneAIStreamManager', () => ({
  xyneAIStreamManager: {
    getAllActiveStreams: (): Map<string, unknown> =>
      new Map([
        ['t1', { status: 'streaming', traceId: 'run-1' }],
        ['t2', { status: 'completed', traceId: 'run-2' }],
        ['t3', { status: 'streaming' }],
        ['t4', { status: 'streaming', traceId: ' run-1 ' }],
      ]),
    subscribe: () => () => undefined,
  },
}));

const tools = vi.hoisted(() => ({
  executePageTool: vi.fn(async () => ({ ok: true, content: 'page text' })),
}));

vi.mock('./workspaceBrowserTools', () => ({
  OTHER_CONVERSATION: 'other conversation shown',
  executePageTool: tools.executePageTool,
  hasWorkspacePages: vi.fn(() => false),
  otherConversationShown: (id: unknown) => id === 'conv-other',
  runExclusive: <T,>(task: () => Promise<T>) => task(),
  subscribeToWorkspacePages: vi.fn(() => () => undefined),
}));

const api = vi.hoisted(() => ({ posts: [] as Array<{ path: string; body: unknown }> }));
vi.mock('../../../services/claw/clawRequest', () => ({
  CLAW_API_BASE: '',
  ClawApiError: class extends Error {
    status = 0;
  },
  clawApiRequest: vi.fn(async (path: string, init?: { body?: string }) => {
    api.posts.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
    return {};
  }),
}));

import { startPagePanelCalls, streamingRunIds, subscribeToArtifactChanges } from './pagePanelCalls';

/** Opens the stream with these `call` events, and leaves it open as the server does. */
function streamCalls(calls: unknown[]): void {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const call of calls) {
        controller.enqueue(encoder.encode(`event: call\ndata: ${JSON.stringify(call)}\n\n`));
      }
    },
  });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(body, { status: 200 }))));
}

describe('page panel calls', () => {
  it('serves only runs that are still streaming', () => {
    expect(streamingRunIds()).toEqual(['run-1']);
  });

  it('refetches artifacts once the stream opens, then for each conversation it names', async () => {
    vi.stubGlobal('window', globalThis);
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: ready\ndata: {"artifacts":true}\n\n'));
        controller.enqueue(
          encoder.encode('event: artifacts\ndata: {"conversationId":"conv-1"}\n\n'),
        );
        // Left open, as the server holds it.
      },
    });
    const fetchMock = vi.fn((_url: string) => Promise.resolve(new Response(body, { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const heard: Array<string | null> = [];
    const unsubscribe = subscribeToArtifactChanges(conversationId => heard.push(conversationId));

    const stop = startPagePanelCalls();
    await vi.waitFor(() => expect(heard).toEqual([null, 'conv-1']));
    // No workspace page: the server is told there is no panel to drive.
    expect(fetchMock.mock.calls[0]?.[0]).toContain('runIds=run-1&panel=0');

    stop();
    unsubscribe();
    vi.unstubAllGlobals();
  });

  describe('answering a page call', () => {
    const settle = () => new Promise(resolve => setTimeout(resolve, 20));

    it('runs a call for the conversation on screen and posts its result', async () => {
      api.posts.length = 0;
      tools.executePageTool.mockClear();
      streamCalls([{ id: 'c1', toolName: 'page-read', args: {}, conversationId: 'conv-1', expiresInMs: 8000 }]);
      const stop = startPagePanelCalls();
      await vi.waitFor(() => expect(api.posts).toHaveLength(1));
      expect(api.posts[0]).toEqual({ path: '/surface/page-calls/c1/result', body: { ok: true, content: 'page text' } });
      stop();
      vi.unstubAllGlobals();
    });

    it('refuses a call made for another conversation (otherConversationShown)', async () => {
      api.posts.length = 0;
      tools.executePageTool.mockClear();
      streamCalls([{ id: 'c2', toolName: 'page-click', args: { ref: 'e1' }, conversationId: 'conv-other' }]);
      const stop = startPagePanelCalls();
      await vi.waitFor(() => expect(api.posts).toHaveLength(1));
      expect(api.posts[0]?.body).toEqual({ ok: false, content: 'other conversation shown' });
      expect(tools.executePageTool).not.toHaveBeenCalled();
      stop();
      vi.unstubAllGlobals();
    });

    it('drops a call whose expiresInMs ran out before its turn, without running or answering it', async () => {
      api.posts.length = 0;
      tools.executePageTool.mockClear();
      streamCalls([{ id: 'c3', toolName: 'page-type', args: { ref: 'e1', text: 'x' }, expiresInMs: 0 }]);
      const stop = startPagePanelCalls();
      await settle();
      await settle();
      expect(tools.executePageTool).not.toHaveBeenCalled();
      expect(api.posts).toHaveLength(0);
      stop();
      vi.unstubAllGlobals();
    });
  });
});
