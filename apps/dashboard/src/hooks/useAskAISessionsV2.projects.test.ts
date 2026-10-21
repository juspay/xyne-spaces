import { describe, expect, it, beforeEach, vi } from 'vitest';
import { QueryClient, type InfiniteData } from '@tanstack/react-query';

// The hook module imports the service, which reaches apiClient -> config.ts
// and dereferences `window` at import time. The cache functions under test
// never call the service, so stubbing the module keeps this suite in Node.
vi.mock('../services/XyneAI/XyneAISessionsV2Service', () => ({
  createV2ChatProject: vi.fn(),
  deleteV2ChatProject: vi.fn(),
  fetchV2ChatProjects: vi.fn(),
  fetchV2Conversations: vi.fn(),
  moveV2ConversationToProject: vi.fn(),
  reorderV2ChatProjects: vi.fn(),
  updateV2ChatProject: vi.fn(),
}));

import {
  V2_CHAT_PROJECTS_KEY,
  moveSessionInCache,
  patchProjectInCache,
  removeProjectFromCache,
  viewHoldsProject,
} from './useAskAISessionsV2';
import type { ChatProject, V2ConversationPage } from '../services/XyneAI/XyneAISessionsV2Service';
import type { ConversationHistory } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

/**
 * The optimistic writes run against a real QueryClient rather than a stub, so
 * these cover the cache semantics the UI actually sees — including the part a
 * field patch cannot express: in a project-filtered view a moved chat has to
 * LEAVE, not just change a field.
 */

const row = (id: string, projectId: string | null): ConversationHistory => ({
  id,
  channelId: '',
  sessionId: `conv-${id}`,
  title: `Chat ${id}`,
  messages: [],
  createdAt: new Date(0),
  lastUpdated: new Date(0),
  projectId,
});

const page = (conversations: ConversationHistory[]): InfiniteData<V2ConversationPage> => ({
  pages: [{ conversations, nextCursor: null, agents: [], projectCounts: {} }],
  pageParams: [null],
});

/** A sessions key: ['xyne-ai-v2-sessions', agentSlug, query, projectFilter]. */
const sessionsKey = (projectFilter: string): readonly unknown[] => [
  'xyne-ai-v2-sessions',
  '',
  '',
  projectFilter,
];

const project = (id: string, name: string, sortOrder: number): ChatProject => ({
  id,
  name,
  icon: null,
  instructions: '',
  instructionsEnabled: true,
  spacesProjectId: null,
  defaultAgentSlug: null,
  sortOrder,
  createdAt: '2026-10-21T00:00:00.000Z',
  updatedAt: '2026-10-21T00:00:00.000Z',
});

const rowsIn = (client: QueryClient, projectFilter: string): ConversationHistory[] =>
  client
    .getQueryData<InfiniteData<V2ConversationPage>>(sessionsKey(projectFilter))
    ?.pages.flatMap(p => p.conversations) ?? [];

describe('viewHoldsProject', () => {
  it('keeps every chat in the unfiltered view', () => {
    expect(viewHoldsProject('', 'proj-1')).toBe(true);
    expect(viewHoldsProject('', null)).toBe(true);
  });

  it('holds only unfiled chats under none', () => {
    expect(viewHoldsProject('none', null)).toBe(true);
    expect(viewHoldsProject('none', 'proj-1')).toBe(false);
  });

  it('holds only its own project', () => {
    expect(viewHoldsProject('proj-1', 'proj-1')).toBe(true);
    expect(viewHoldsProject('proj-1', 'proj-2')).toBe(false);
    expect(viewHoldsProject('proj-1', null)).toBe(false);
  });
});

describe('moveSessionInCache', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    client.setQueryData(sessionsKey(''), page([row('a', 'proj-1'), row('b', null)]));
    client.setQueryData(sessionsKey('proj-1'), page([row('a', 'proj-1')]));
    client.setQueryData(sessionsKey('proj-2'), page([]));
    client.setQueryData(sessionsKey('none'), page([row('b', null)]));
  });

  it('rewrites the chat in the unfiltered view', () => {
    moveSessionInCache(client, 'a', 'proj-2');
    expect(rowsIn(client, '').find(r => r.id === 'a')?.projectId).toBe('proj-2');
  });

  it('removes the chat from the view of the project it left', () => {
    moveSessionInCache(client, 'a', 'proj-2');
    expect(rowsIn(client, 'proj-1').map(r => r.id)).toEqual([]);
  });

  it('removes a newly filed chat from the unfiled view', () => {
    moveSessionInCache(client, 'b', 'proj-1');
    expect(rowsIn(client, 'none').map(r => r.id)).toEqual([]);
    expect(rowsIn(client, '').find(r => r.id === 'b')?.projectId).toBe('proj-1');
  });

  it('keeps an unfiled chat in the unfiled view', () => {
    moveSessionInCache(client, 'a', null);
    expect(rowsIn(client, '').find(r => r.id === 'a')?.projectId).toBeNull();
    expect(rowsIn(client, 'proj-1').map(r => r.id)).toEqual([]);
  });

  it('leaves other chats untouched', () => {
    moveSessionInCache(client, 'a', 'proj-2');
    expect(rowsIn(client, '').find(r => r.id === 'b')?.projectId).toBeNull();
  });

  it('restores every view exactly on rollback', () => {
    const before = {
      all: rowsIn(client, ''),
      p1: rowsIn(client, 'proj-1'),
      none: rowsIn(client, 'none'),
    };

    const rollback = moveSessionInCache(client, 'a', 'proj-2');
    rollback();

    expect(rowsIn(client, '')).toEqual(before.all);
    expect(rowsIn(client, 'proj-1')).toEqual(before.p1);
    expect(rowsIn(client, 'none')).toEqual(before.none);
  });

  it('does not invent the row in the destination view', () => {
    // That page may not be loaded and the row's sort position is unknown, so
    // the destination is refetched instead of guessed.
    moveSessionInCache(client, 'a', 'proj-2');
    expect(rowsIn(client, 'proj-2').map(r => r.id)).toEqual([]);
  });
});

describe('removeProjectFromCache', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    client.setQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY, [
      project('proj-1', 'One', 0),
      project('proj-2', 'Two', 1),
    ]);
    client.setQueryData(sessionsKey(''), page([row('a', 'proj-1'), row('b', 'proj-2')]));
    client.setQueryData(sessionsKey('proj-1'), page([row('a', 'proj-1')]));
  });

  it('drops the project from the list', () => {
    removeProjectFromCache(client, 'proj-1');
    expect(client.getQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY)?.map(p => p.id)).toEqual([
      'proj-2',
    ]);
  });

  it('unfiles its chats rather than deleting them', () => {
    removeProjectFromCache(client, 'proj-1');
    const moved = rowsIn(client, '').find(r => r.id === 'a');
    // Deleting a project never deletes chats — they return to the main list.
    expect(moved).toBeDefined();
    expect(moved?.projectId).toBeNull();
  });

  it('empties the deleted project own view', () => {
    removeProjectFromCache(client, 'proj-1');
    expect(rowsIn(client, 'proj-1').map(r => r.id)).toEqual([]);
  });

  it('leaves another project chats alone', () => {
    removeProjectFromCache(client, 'proj-1');
    expect(rowsIn(client, '').find(r => r.id === 'b')?.projectId).toBe('proj-2');
  });

  it('restores both caches on rollback', () => {
    const projectsBefore = client.getQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY);
    const rowsBefore = rowsIn(client, '');

    const rollback = removeProjectFromCache(client, 'proj-1');
    rollback();

    expect(client.getQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY)).toEqual(projectsBefore);
    expect(rowsIn(client, '')).toEqual(rowsBefore);
  });
});

describe('patchProjectInCache', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient();
    client.setQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY, [
      project('proj-1', 'One', 0),
      project('proj-2', 'Two', 1),
    ]);
  });

  it('renames only the target project', () => {
    patchProjectInCache(client, 'proj-1', { name: 'Renamed' });
    const projects = client.getQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY) ?? [];
    expect(projects.find(p => p.id === 'proj-1')?.name).toBe('Renamed');
    expect(projects.find(p => p.id === 'proj-2')?.name).toBe('Two');
  });

  it('restores the previous name on rollback', () => {
    const rollback = patchProjectInCache(client, 'proj-1', { name: 'Renamed' });
    rollback();
    expect(
      client.getQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY)?.find(p => p.id === 'proj-1')?.name,
    ).toBe('One');
  });

  it('is a no-op for an id that is not cached', () => {
    const before = client.getQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY);
    patchProjectInCache(client, 'proj-missing', { name: 'Nope' });
    expect(client.getQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY)).toEqual(before);
  });
});
