import { describe, expect, it } from 'vitest';

import { canFileSession, findSessionInCachedPages } from './SidebarProjects.utils';

/**
 * The chat header has no conversation endpoint that returns projectId, so it
 * asks the caches. The case worth pinning is the one the obvious version gets
 * wrong: the unfiltered view holds only its first page, and a chat opened from
 * a project's own sidebar list is routinely absent from it while sitting in
 * that project's view.
 */

const session = (sessionId: string, over: Record<string, unknown> = {}) => ({
  id: `row-${sessionId}`,
  sessionId,
  projectId: null,
  ...over,
});

const view = (...sessionIds: string[]) => [{ conversations: sessionIds.map(id => session(id)) }];

describe('findSessionInCachedPages', () => {
  it('returns null when no view is cached', () => {
    expect(findSessionInCachedPages([], 'chat-1')).toBeNull();
  });

  it('finds a chat in the unfiltered view', () => {
    expect(findSessionInCachedPages([view('chat-1')], 'chat-1')?.id).toBe('row-chat-1');
  });

  // The case a first-page-only lookup misses.
  it("finds a chat held only in a project's own view", () => {
    const unfiltered = view('chat-9');
    const projectView = [{ conversations: [session('chat-1', { projectId: 'proj-1' })] }];
    const found = findSessionInCachedPages([unfiltered, projectView], 'chat-1');
    expect(found?.id).toBe('row-chat-1');
    expect(found?.projectId).toBe('proj-1');
  });

  it('searches past the first page of a view', () => {
    const paged = [{ conversations: [session('chat-9')] }, { conversations: [session('chat-2')] }];
    expect(findSessionInCachedPages([paged], 'chat-2')?.id).toBe('row-chat-2');
  });

  it('returns null for a conversation in no cached view', () => {
    expect(findSessionInCachedPages([view('chat-1')], 'chat-absent')).toBeNull();
  });

  it('skips an unfetched view instead of throwing', () => {
    expect(findSessionInCachedPages([undefined, view('chat-1')], 'chat-1')?.id).toBe('row-chat-1');
  });

  it('returns the first match when a chat is cached in several views', () => {
    const first = [{ conversations: [session('chat-1', { projectId: 'proj-1' })] }];
    const second = [{ conversations: [session('chat-1', { projectId: 'proj-2' })] }];
    expect(findSessionInCachedPages([first, second], 'chat-1')?.projectId).toBe('proj-1');
  });
});

describe('canFileSession', () => {
  it('allows a direct chat', () => {
    expect(canFileSession({ sessionId: 'chat-1' })).toBe(true);
  });

  // Mirrors isDirectChatConversation in claw-auth: a Spaces thread lists one
  // row per agent while membership is keyed by conversation alone, so the
  // PATCH answers 400 and the option must not be offered.
  it.each(['thread-1', 'conv-1', ''])('refuses a non-direct conversation (%s)', sessionId => {
    expect(canFileSession({ sessionId })).toBe(false);
  });
});
