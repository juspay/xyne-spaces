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
  },
}));

vi.mock('./workspaceBrowserTools', () => ({
  executePageTool: vi.fn(),
  getWorkspaceWebview: vi.fn(() => null),
}));

import { streamingRunIds } from './pagePanelPoller';

describe('page panel poller', () => {
  it('polls only for runs that are still streaming', () => {
    expect(streamingRunIds()).toEqual(['run-1']);
  });
});
