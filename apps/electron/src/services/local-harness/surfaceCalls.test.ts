import { describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, net: { fetch: vi.fn() } }));
vi.mock('../../window/manager', () => ({ getMainWindow: () => null }));
vi.mock('./workspaceBrowser', () => ({
  isWorkspacePageTool: (name: string) => name.startsWith('page-'),
  workspaceBrowserBridge: { call: vi.fn() },
}));

import { isAnswerableSurfaceTool, parseSseBlock, parseSurfaceCall } from './surfaceCalls';

describe('surface calls', () => {
  it('answers app tools, browser page tools and open-url only', () => {
    expect(isAnswerableSurfaceTool('app-navigate')).toBe(true);
    expect(isAnswerableSurfaceTool('page-click')).toBe(true);
    expect(isAnswerableSurfaceTool('open-url')).toBe(true);
    expect(isAnswerableSurfaceTool('sandbox-exec')).toBe(false);
    expect(isAnswerableSurfaceTool('local-shell')).toBe(false);
  });

  it('reads server-sent events and ignores keepalives', () => {
    expect(parseSseBlock(':ka')).toBeNull();
    expect(parseSseBlock('event: call\ndata: {"id":"c1"}')).toEqual({ event: 'call', data: '{"id":"c1"}' });
    expect(parseSseBlock('data: a\ndata: b')).toEqual({ event: 'message', data: 'a\nb' });
  });

  it('accepts only well-formed calls', () => {
    expect(parseSurfaceCall('{"id":"c1","toolName":"page-read","args":{"x":1}}')).toEqual({
      id: 'c1',
      toolName: 'page-read',
      args: { x: 1 },
    });
    expect(parseSurfaceCall('{"id":"c1"}')).toBeNull();
    expect(parseSurfaceCall('not json')).toBeNull();
  });
});
