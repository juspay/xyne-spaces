import { describe, expect, it, vi } from 'vitest';

vi.mock('../../InAppBrowser/BrowserWebview', () => ({ wakePage: vi.fn() }));

import { otherConversationShown, runExclusive, showWorkspaceConversation } from './workspaceBrowserTools';

describe('browser panel guards', () => {
  it('runs browser calls one at a time, in order, even when one fails', async () => {
    const order: string[] = [];
    const slow = runExclusive(async () => {
      order.push('a:start');
      await new Promise(resolve => setTimeout(resolve, 20));
      order.push('a:end');
      throw new Error('boom');
    });
    const fast = runExclusive(async () => {
      order.push('b');
      return 'b';
    });
    await expect(slow).rejects.toThrow('boom');
    await expect(fast).resolves.toBe('b');
    expect(order).toEqual(['a:start', 'a:end', 'b']);
  });

  it('refuses calls for a conversation other than the one on screen', () => {
    expect(otherConversationShown('conv-1')).toBe(false);
    const hide = showWorkspaceConversation('conv-1');
    expect(otherConversationShown('conv-1')).toBe(false);
    expect(otherConversationShown('conv-2')).toBe(true);
    expect(otherConversationShown('')).toBe(false);
    expect(otherConversationShown(undefined)).toBe(false);
    hide();
    expect(otherConversationShown('conv-2')).toBe(false);
  });
});
