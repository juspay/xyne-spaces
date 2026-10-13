import { describe, it, expect, vi, beforeEach } from 'vitest';

// A reattached (/live) viewer must be able to cancel the run upstream:
// the run id arrives in the snapshot, and Stop posts it to /v2/cancel (XYNE-66347).

// The manager's import graph reads browser globals at module load; the dashboard
// test env is node, so provide the minimum before anything is imported.
vi.hoisted(() => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  const g = globalThis as Record<string, unknown>;
  g['window'] = {
    location: { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost', href: 'http://localhost/' },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    localStorage: storage,
    sessionStorage: storage,
  };
  g['localStorage'] = storage;
  g['sessionStorage'] = storage;
  g['__APP_VERSION__'] = 'test';
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
  g['document'] = { addEventListener: () => undefined, removeEventListener: () => undefined, visibilityState: 'visible' };
  g['requestAnimationFrame'] = (cb: () => void) => setTimeout(cb, 0) as unknown as number;
  g['cancelAnimationFrame'] = (id: number) => clearTimeout(id);
});

const post = vi.fn(() => Promise.resolve({ data: {} }));
let emit: ((type: string, data: Record<string, unknown>) => void) | undefined;

vi.mock('../xyneAIStream.worker?worker', () => ({
  default: class {
    onmessage: unknown = null;
    onerror: unknown = null;
    postMessage(): void {}
    terminate(): void {}
    addEventListener(): void {}
  },
}));
vi.mock('../../clients/apiClient', () => ({
  apiInstance: { post, get: vi.fn(() => Promise.resolve({ data: {} })) },
  BASE_URL: 'http://test/api',
}));
vi.mock('../../../utils/logger', () => {
  const noop = () => undefined;
  return {
    logger: { info: noop, warn: noop, error: noop, debug: noop, log: noop, event: noop },
    Event: new Proxy({}, { get: (_t, k) => String(k) }),
  };
});
vi.mock('../../../utils/reactNativeBridge', () => ({
  reactNativeBridge: { isNative: () => false, on: () => () => undefined, send: () => undefined, post: () => undefined },
  NativeInboundMessageType: new Proxy({}, { get: (_t, k) => String(k) }),
}));
vi.mock('../../otel/xyneAIMetrics', () => ({ trackCitationsGenerated: () => undefined }));
vi.mock('../../Analytics/globalClickTracker', () => ({ globalClickTracker: { track: () => undefined } }));
vi.mock('sonner', () => ({ toast: Object.assign(() => undefined, { error: () => undefined, success: () => undefined }) }));
vi.mock('../../../components/workspaceItems', () => ({
  consumePendingPassage: () => undefined,
  readOpenItems: () => [],
}));
vi.mock('../liveConversationStream', () => ({
  consumeConversationLiveStream: (opts: {
    onEvent: (t: string, d: Record<string, unknown>) => void;
  }) => {
    emit = opts.onEvent;
    return new Promise<void>(() => undefined); // stays open, like a live SSE
  },
}));

const load = async () => (await import('../XyneAIStreamManager')).xyneAIStreamManager;

const partial = { msgId: 'm1', content: 'working…', createdAt: new Date().toISOString() };

describe('live viewer Stop', () => {
  beforeEach(() => {
    post.mockClear();
    emit = undefined;
  });

  it('cancels the run id carried by the /live snapshot', async () => {
    const mgr = await load();
    mgr.attachLiveViewer('thread-a', 'chat-conv-a');
    emit!('snapshot', { inProgress: [], partial, runSessionId: 'run-123' });

    const state = mgr.getActiveStream('thread-a');
    expect(state?.traceId).toBe('run-123');
    mgr.abortStream(state!.streamId);

    expect(post).toHaveBeenCalledWith('/xyne-ai/v2/cancel/run-123');
  });

  it('adopts the run id from a later snapshot when the viewer started on a delta', async () => {
    const mgr = await load();
    mgr.attachLiveViewer('thread-b', 'chat-conv-b');
    emit!('delta', { content: 'hi' });
    expect(mgr.getActiveStream('thread-b')?.traceId).toBeUndefined();

    emit!('snapshot', { inProgress: [], partial, runSessionId: 'run-456' });
    const state = mgr.getActiveStream('thread-b');
    mgr.abortStream(state!.streamId);

    expect(post).toHaveBeenCalledWith('/xyne-ai/v2/cancel/run-456');
  });

  it('stays watch-only (no cancel call) when the snapshot carries no run id', async () => {
    const mgr = await load();
    mgr.attachLiveViewer('thread-c', 'chat-conv-c');
    emit!('snapshot', { inProgress: [], partial });
    mgr.abortStream(mgr.getActiveStream('thread-c')!.streamId);

    expect(post).not.toHaveBeenCalled();
  });
});
