import { describe, expect, it } from 'vitest';

import {
  canFileSession,
  findSessionInCachedPages,
  rememberedSessionFor,
  sessionWithPendingProject,
} from './SidebarProjects.utils';

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

describe('findSessionInCachedPages reference stability', () => {
  // useCachedV2Session feeds this straight into useSyncExternalStore, which
  // re-renders on every reference change. A fresh object per read would loop
  // forever, so the row must come back by reference, never rebuilt.
  const views = [[{ conversations: [{ sessionId: 'chat-1', projectId: 'proj-1' }] }]];

  it('returns the same object on repeated reads of unchanged pages', () => {
    const first = findSessionInCachedPages(views, 'chat-1');
    const second = findSessionInCachedPages(views, 'chat-1');
    expect(first).not.toBeNull();
    expect(first).toBe(second);
  });

  it("returns the cache's own row, not a copy of it", () => {
    const row = views[0]?.[0]?.conversations[0];
    expect(findSessionInCachedPages(views, 'chat-1')).toBe(row);
  });

  it('returns null consistently for a chat no view holds', () => {
    expect(findSessionInCachedPages(views, 'chat-absent')).toBeNull();
    expect(findSessionInCachedPages(views, 'chat-absent')).toBeNull();
  });
});

describe('sessionWithPendingProject', () => {
  const session = { sessionId: 'chat-1', projectId: 'proj-old' };

  it('passes the cached row through untouched when nothing is pending', () => {
    expect(sessionWithPendingProject(session, undefined)).toBe(session);
  });

  it('shows the project the user just picked, before the lists agree', () => {
    expect(sessionWithPendingProject(session, 'proj-new')).toEqual({
      sessionId: 'chat-1',
      projectId: 'proj-new',
    });
  });

  // null is "remove from project" and must not be mistaken for "nothing pending".
  it('shows no project after a removal', () => {
    expect(sessionWithPendingProject(session, null)).toEqual({
      sessionId: 'chat-1',
      projectId: null,
    });
  });

  it('does not mutate the cached row while overlaying', () => {
    sessionWithPendingProject(session, 'proj-new');
    expect(session.projectId).toBe('proj-old');
  });

  it('has nothing to describe when no row resolved at all', () => {
    expect(sessionWithPendingProject(null, 'proj-new')).toBeNull();
    expect(sessionWithPendingProject(undefined, undefined)).toBeNull();
  });
});

describe('rememberedSessionFor', () => {
  const chatA = { sessionId: 'chat-a', projectId: 'proj-a' };

  it('reuses the remembered row while its own chat is open', () => {
    expect(rememberedSessionFor(chatA, 'chat-a')).toBe(chatA);
  });

  // Without this the header named chat A's project while chat B was on screen,
  // and moving from that badge moved chat A.
  it('does not use a row remembered for chat A when chat B is open', () => {
    expect(rememberedSessionFor(chatA, 'chat-b')).toBeNull();
  });

  it('has nothing to reuse once no chat is open', () => {
    expect(rememberedSessionFor(chatA, null)).toBeNull();
    expect(rememberedSessionFor(chatA, '')).toBeNull();
  });

  it('has nothing to reuse before a row has been resolved', () => {
    expect(rememberedSessionFor(null, 'chat-a')).toBeNull();
    expect(rememberedSessionFor(undefined, 'chat-a')).toBeNull();
  });
});
