import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// XYNE-66353: every per-stream buffer must be released when a stream is
// aborted or a live viewer is closed, not only on done/error.

// --- isolate the manager from the browser, worker, network and storage ---
vi.mock('../xyneAIStream.worker?worker', () => ({
  default: class {
    addEventListener(): void {}
    postMessage(): void {}
  },
}));
vi.mock('../../../utils/reactNativeBridge', () => ({
  reactNativeBridge: { on: vi.fn() },
  NativeInboundMessageType: { NATIVE_APP_FOREGROUND: 'NATIVE_APP_FOREGROUND' },
}));
vi.mock('../XyneAIStreamStorage', () => ({
  xyneAIStreamStorage: {
    getActiveStreams: vi.fn(() => Promise.resolve([])),
    getAllActiveStreams: vi.fn(() => Promise.resolve([])),
    cleanupOldStreams: vi.fn(() => Promise.resolve(undefined)),
    abortStream: vi.fn(() => Promise.resolve(undefined)),
    getActiveStreamForThread: vi.fn(() => Promise.resolve(null)),
  },
}));
vi.mock('../../clients/apiClient', () => ({
  apiInstance: {
    post: vi.fn(() => Promise.resolve({})),
    get: vi.fn(() => Promise.resolve({ data: {} })),
  },
  BASE_URL: 'http://test',
}));
// A live viewer whose SSE stays open until its signal aborts.
vi.mock('../liveConversationStream', () => ({
  consumeConversationLiveStream: vi.fn(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise<void>(resolve => signal.addEventListener('abort', () => resolve())),
  ),
}));
vi.mock('../XyneAISessionsV2Service', () => ({
  fetchV2ConversationMessages: vi.fn(() => Promise.resolve([])),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock('../../../utils/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  Event: new Proxy({}, { get: (_t, k): string => String(k) }),
}));
vi.mock('../../otel/xyneAIMetrics', () => ({ trackCitationsGenerated: vi.fn() }));
vi.mock('../../Analytics/globalClickTracker', () => ({
  globalClickTracker: { track: vi.fn(), trackEvent: vi.fn() },
}));

vi.mock('../../../components/workspaceItems', () => ({
  consumePendingPassage: vi.fn(() => null),
  readOpenItems: vi.fn(() => []),
}));
vi.mock('../../../components/Claw/claw.utils', () => ({
  resolveMessagePendingAction: vi.fn((m: unknown) => m),
}));

interface ManagerInternals {
  activeStreams: Map<string, Record<string, unknown>>;
  abortControllers: Map<string, AbortController>;
  streamDataMap: Map<string, unknown>;
  pendingDeltaMap: Map<string, string>;
  pendingTextPartsMap: Map<string, unknown[]>;
  rafIdMap: Map<string, number>;
  workerActiveStreams: Set<string>;
  liveViewerStreams: Set<string>;
  reportRunOutcome: (...args: unknown[]) => void;
  abortStream: (streamId: string, reason?: 'user' | 'replaced') => void;
  attachLiveViewer: (threadId: string, convId: string, agentSlug?: string) => () => void;
}

let manager: ManagerInternals;

const seedBuffers = (streamId: string): void => {
  manager.streamDataMap.set(streamId, { rawContent: 'partial' });
  manager.pendingDeltaMap.set(streamId, 'buffered delta');
  manager.pendingTextPartsMap.set(streamId, [{ type: 'text', delta: 'buffered' }]);
  manager.rafIdMap.set(streamId, 42);
  manager.workerActiveStreams.add(streamId);
};

const expectReleased = (streamId: string): void => {
  expect(manager.streamDataMap.has(streamId)).toBe(false);
  expect(manager.pendingDeltaMap.has(streamId)).toBe(false);
  expect(manager.pendingTextPartsMap.has(streamId)).toBe(false);
  expect(manager.rafIdMap.has(streamId)).toBe(false);
  expect(manager.workerActiveStreams.has(streamId)).toBe(false);
  expect(manager.liveViewerStreams.has(streamId)).toBe(false);
  expect(manager.abortControllers.has(streamId)).toBe(false);
};

beforeAll(async () => {
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const mod = await import('../XyneAIStreamManager');
  manager = mod.xyneAIStreamManager as unknown as ManagerInternals;
  vi.spyOn(manager, 'reportRunOutcome').mockImplementation(() => undefined);
});

beforeEach(() => {
  manager.activeStreams.clear();
});

describe('XyneAIStreamManager buffer cleanup (XYNE-66353)', () => {
  it('abortStream releases every per-stream buffer, including pendingTextPartsMap', () => {
    const streamId = 'stream-abort-1';
    manager.activeStreams.set('thread-1', {
      streamId,
      threadId: 'thread-1',
      status: 'streaming',
      messages: [],
      traceId: '',
    });
    manager.abortControllers.set(streamId, new AbortController());
    seedBuffers(streamId);

    manager.abortStream(streamId);

    expect(manager.activeStreams.has('thread-1')).toBe(false);
    expectReleased(streamId);
  });

  it('abortStream releases buffers even when the stream state is already gone', () => {
    const streamId = 'stream-late-abort';
    seedBuffers(streamId);

    manager.abortStream(streamId);

    expectReleased(streamId);
  });

  it('closing a live viewer releases every per-stream buffer', async () => {
    const before = new Set(manager.liveViewerStreams);
    const close = manager.attachLiveViewer('thread-live', 'chat-live-1');
    const streamId = [...manager.liveViewerStreams].find(id => !before.has(id));
    expect(streamId).toBeDefined();
    seedBuffers(streamId as string);

    close();
    await Promise.resolve();

    expectReleased(streamId as string);
  });
});
