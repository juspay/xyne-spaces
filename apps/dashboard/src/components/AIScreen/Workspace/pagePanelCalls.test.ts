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

vi.mock('./workspaceBrowserTools', () => ({
  executePageTool: vi.fn(),
  hasWorkspacePages: vi.fn(() => false),
  subscribeToWorkspacePages: vi.fn(() => () => undefined),
}));

import { startPagePanelCalls, streamingRunIds, subscribeToArtifactChanges } from './pagePanelCalls';

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
});
