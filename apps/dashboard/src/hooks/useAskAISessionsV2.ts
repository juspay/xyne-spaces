/**
 * Hook for managing Ask AI v2 sessions via xyne-claw backend.
 *
 * Uses claw conversation APIs (proxied through Spaces backend) instead of
 * the v1 session store. Provides the same interface as useAskAISessions
 * so the sidebar can switch between versions seamlessly.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import {
  createV2ChatProject,
  deleteV2ChatProject,
  fetchV2ChatProjectKnowledge,
  fetchV2ChatProjects,
  fetchV2Conversations,
  deleteV2ChatProjectKnowledge,
  type ChatProjectKnowledge,
  moveV2ConversationToProject,
  reorderV2ChatProjects,
  updateV2ChatProject,
  type AgentConversationCount,
  type ChatProject,
  type ChatProjectInput,
  type V2ConversationPage,
} from '../services/XyneAI/XyneAISessionsV2Service';
import type { ConversationHistory } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

// ============================================================================
// Query Keys
// ============================================================================

const V2_SESSIONS_KEY = ['xyne-ai-v2-sessions'] as const;
export const V2_CHAT_PROJECTS_KEY = ['xyne-ai-v2-chat-projects'] as const;
/** Index of the project filter inside a sessions query key. */
const SESSIONS_KEY_PROJECT_INDEX = 3;
const v2SessionMessagesKey = (convId: string, agentSlug?: string | null): readonly string[] =>
  agentSlug
    ? ['xyne-ai-v2-session', convId, 'messages', agentSlug]
    : ['xyne-ai-v2-session', convId, 'messages'];

// ============================================================================
// Hooks
// ============================================================================

const NO_AGENTS: AgentConversationCount[] = [];
const NO_PROJECT_COUNTS: Record<string, number> = {};

interface V2SessionsListOptions {
  /** Keep only this agent's conversations (server-side). */
  agentSlug?: string | null;
  /** Title search (server-side). */
  query?: string;
  enabled?: boolean;
  /** Refetch whenever the list mounts — for panels the user opens to look. */
  refetchOnMount?: boolean | 'always';
  /** A project id to list, or `'none'` for unfiled chats (server-side). */
  projectId?: string | null;
}

/**
 * The user's chat history across every agent, newest first, a page of 50 at a
 * time (every pinned chat comes with the first page). Shared by the AI screen,
 * the sidebar and the overlay. Filter and search run on the server, so they
 * reach chats that are not loaded yet; `loadMore` fetches the next page.
 */
export function useV2SessionsList({
  agentSlug = null,
  query = '',
  enabled = true,
  refetchOnMount = true,
  projectId = null,
}: V2SessionsListOptions = {}) {
  const result = useInfiniteQuery({
    // The project filter is part of the key so each view caches separately —
    // and so the optimistic move can tell which views a chat still belongs in.
    queryKey: [...V2_SESSIONS_KEY, agentSlug ?? '', query, projectId ?? ''],
    queryFn: ({ pageParam }) =>
      fetchV2Conversations({ agentSlug, q: query, cursor: pageParam, projectId }),
    initialPageParam: null as string | null,
    getNextPageParam: page => page.nextCursor ?? undefined,
    // Changing the filter or search keeps the current rows on screen until
    // the new ones arrive, instead of flashing an empty list.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    refetchOnMount,
    enabled,
  });
  const conversations = useMemo(() => {
    const seen = new Set<string>();
    return (result.data?.pages ?? [])
      .flatMap(page => page.conversations)
      .filter(row => !seen.has(row.id) && Boolean(seen.add(row.id)));
  }, [result.data]);
  return {
    conversations,
    agents: result.data?.pages[0]?.agents ?? NO_AGENTS,
    /** Chats per project id, for the sidebar. Every project's total, not just
     *  the one being viewed. */
    projectCounts: result.data?.pages[0]?.projectCounts ?? NO_PROJECT_COUNTS,
    isLoading: result.isLoading,
    hasMore: result.hasNextPage,
    isLoadingMore: result.isFetchingNextPage,
    loadMore: result.fetchNextPage,
  };
}

/**
 * Invalidate the chat history (call after new chat, etc.) — a turn with any
 * agent changes it.
 */
/**
 * One chat's saved title, from whichever history page already holds it; null when none does (a new
 * chat, or a list not loaded yet). Updates as the history is fetched again.
 */
export function useCachedV2ConversationTitle(sessionId: string | null | undefined): string | null {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const read = useCallback((): string | null => {
    if (!sessionId) return null;
    const lists = queryClient.getQueriesData<InfiniteData<V2ConversationPage>>({
      queryKey: V2_SESSIONS_KEY,
    });
    for (const [, data] of lists) {
      const row = data?.pages
        .flatMap(page => page.conversations)
        .find(conversation => conversation.sessionId === sessionId);
      // The list says 'New Chat' for a chat with no title at all.
      if (row?.title && row.title !== 'New Chat') return row.title;
    }
    return null;
  }, [queryClient, sessionId]);
  return useSyncExternalStore(subscribe, read);
}

export function useV2SessionInvalidator() {
  const queryClient = useQueryClient();

  const invalidateSessions = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: V2_SESSIONS_KEY });
  }, [queryClient]);

  const invalidateMessages = useCallback(
    (convId: string, agentSlug?: string | null) => {
      void queryClient.invalidateQueries({ queryKey: v2SessionMessagesKey(convId, agentSlug) });
    },
    [queryClient],
  );

  return { invalidateSessions, invalidateMessages };
}

/**
 * Apply a change to one conversation in the cached list immediately, and hand
 * back a rollback.
 *
 * Rename and pin used to rely on invalidate-then-refetch alone, which made a
 * success wait a round trip and — worse — made a FAILURE look like a
 * successful revert: the refetch returned the server's unchanged row, so the
 * old title reappeared with nothing said. Writing the cache up front and
 * rolling back on error keeps the two outcomes distinguishable.
 */
export function useV2SessionPatcher() {
  const queryClient = useQueryClient();

  const patchSession = useCallback(
    (rowId: string, patch: Partial<ConversationHistory>): (() => void) => {
      // Every cached view of the list (each filter and search) holds its own
      // pages; patch the row wherever it is loaded.
      const previous = queryClient.getQueriesData<InfiniteData<V2ConversationPage>>({
        queryKey: V2_SESSIONS_KEY,
      });
      queryClient.setQueriesData<InfiniteData<V2ConversationPage>>(
        { queryKey: V2_SESSIONS_KEY },
        data =>
          data && {
            ...data,
            pages: data.pages.map(page => ({
              ...page,
              conversations: page.conversations.map(row =>
                row.id === rowId ? { ...row, ...patch } : row,
              ),
            })),
          },
      );
      return () => previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    [queryClient],
  );

  return { patchSession };
}

// ============================================================================
// Chat projects
// ============================================================================

type SessionsEntry = [readonly unknown[], InfiniteData<V2ConversationPage> | undefined];

/**
 * Would a cached list view still show a chat that now sits in `projectId`?
 *
 * `''` is the unfiltered view and keeps everything; `'none'` holds only
 * unfiled chats. This is what makes a move more than a field edit: in a
 * filtered view the row has to LEAVE, and the existing session patcher only
 * rewrites fields in place.
 */
export function viewHoldsProject(viewFilter: string, projectId: string | null): boolean {
  if (!viewFilter) {
    return true;
  }
  if (viewFilter === 'none') {
    return projectId === null;
  }
  return viewFilter === projectId;
}

function sessionsEntries(queryClient: QueryClient): SessionsEntry[] {
  return queryClient.getQueriesData<InfiniteData<V2ConversationPage>>({
    queryKey: V2_SESSIONS_KEY,
  });
}

function rollbackTo(queryClient: QueryClient, previous: SessionsEntry[]): () => void {
  return () => {
    previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
  };
}

function viewFilterOf(key: readonly unknown[]): string {
  const raw = key[SESSIONS_KEY_PROJECT_INDEX];
  return typeof raw === 'string' ? raw : '';
}

/**
 * Move a chat between projects in every cached list view at once, and hand
 * back a rollback.
 *
 * In views the chat no longer belongs to it is removed rather than patched.
 * A view it has moved INTO cannot gain the row here — that page may not be
 * loaded, and inventing a row would put it in the wrong sort position — so
 * those views are refetched by the caller instead.
 */
export function moveSessionInCache(
  queryClient: QueryClient,
  rowId: string,
  projectId: string | null,
): () => void {
  const previous = sessionsEntries(queryClient);
  for (const [key, data] of previous) {
    if (!data) {
      continue;
    }
    const keeps = viewHoldsProject(viewFilterOf(key), projectId);
    queryClient.setQueryData<InfiniteData<V2ConversationPage>>(key, {
      ...data,
      pages: data.pages.map(page => ({
        ...page,
        conversations: page.conversations.flatMap(row => {
          if (row.id !== rowId) {
            return [row];
          }
          return keeps ? [{ ...row, projectId }] : [];
        }),
      })),
    });
  }
  return rollbackTo(queryClient, previous);
}

/**
 * Delete a project optimistically: drop it from the project list, and unfile
 * its chats wherever they are cached. claw-auth never deletes the chats
 * themselves, so they must reappear in the main list rather than vanish.
 */
export function removeProjectFromCache(queryClient: QueryClient, projectId: string): () => void {
  const previousProjects = queryClient.getQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY);
  queryClient.setQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY, (projects): ChatProject[] =>
    (projects ?? []).filter(project => project.id !== projectId),
  );

  const previous = sessionsEntries(queryClient);
  for (const [key, data] of previous) {
    if (!data) {
      continue;
    }
    const filter = viewFilterOf(key);
    queryClient.setQueryData<InfiniteData<V2ConversationPage>>(key, {
      ...data,
      pages: data.pages.map(page => ({
        ...page,
        conversations: page.conversations.flatMap(row => {
          if (row.projectId !== projectId) {
            return [row];
          }
          // The chat is now unfiled: it leaves this project's view, stays in
          // the unfiltered one, and belongs in `none`.
          return filter === projectId ? [] : [{ ...row, projectId: null }];
        }),
      })),
    });
  }

  const restoreSessions = rollbackTo(queryClient, previous);
  return () => {
    queryClient.setQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY, previousProjects);
    restoreSessions();
  };
}

/** Rename or otherwise patch a project in the cached list, with a rollback. */
export function patchProjectInCache(
  queryClient: QueryClient,
  projectId: string,
  patch: Partial<ChatProject>,
): () => void {
  const previous = queryClient.getQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY);
  queryClient.setQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY, (projects): ChatProject[] =>
    (projects ?? []).map(project =>
      project.id === projectId ? { ...project, ...patch } : project,
    ),
  );
  return () => {
    queryClient.setQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY, previous);
  };
}

/** The caller's chat projects, ordered as they arranged them. */
export function useV2ChatProjects({ enabled = true }: { enabled?: boolean } = {}) {
  const result = useQuery({
    queryKey: V2_CHAT_PROJECTS_KEY,
    queryFn: fetchV2ChatProjects,
    staleTime: 30_000,
    enabled,
  });
  return {
    projects: result.data ?? NO_PROJECTS,
    isLoading: result.isLoading,
  };
}

const NO_PROJECTS: ChatProject[] = [];

const NO_KNOWLEDGE: ChatProjectKnowledge[] = [];

export const v2ChatProjectKnowledgeKey = (projectId: string): readonly string[] => [
  'xyne-ai-v2-chat-project-knowledge',
  projectId,
];

export function useV2ChatProjectKnowledge(projectId: string | undefined) {
  const queryClient = useQueryClient();
  const key = v2ChatProjectKnowledgeKey(projectId ?? '');
  const result = useQuery({
    queryKey: key,
    queryFn: () => fetchV2ChatProjectKnowledge(projectId as string),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });

  const detach = useCallback(
    async (knowledgeId: string): Promise<void> => {
      if (!projectId) return;
      const previous = queryClient.getQueryData<ChatProjectKnowledge[]>(key);
      queryClient.setQueryData<ChatProjectKnowledge[]>(key, (items): ChatProjectKnowledge[] =>
        (items ?? []).filter(item => item.id !== knowledgeId),
      );
      try {
        await deleteV2ChatProjectKnowledge(projectId, knowledgeId);
      } catch (error) {
        queryClient.setQueryData(key, previous);
        throw error;
      }
    },
    [projectId, queryClient, key],
  );

  return {
    knowledge: result.data ?? NO_KNOWLEDGE,
    isLoading: result.isLoading,
    isError: result.isError,
    detach,
  };
}

/**
 * Project writes that show instantly and roll back on failure.
 *
 * Same reasoning as useV2SessionPatcher: invalidate-then-refetch alone makes a
 * success wait a round trip and makes a FAILURE look like a silent revert,
 * because the refetch returns the server's unchanged row.
 */
export function useV2ChatProjectActions() {
  const queryClient = useQueryClient();

  const invalidateProjects = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: V2_CHAT_PROJECTS_KEY });
  }, [queryClient]);

  const moveChatToProject = useCallback(
    async (
      rowId: string,
      conversationId: string,
      projectId: string | null,
      agentSlug?: string | null,
    ): Promise<void> => {
      const rollback = moveSessionInCache(queryClient, rowId, projectId);
      try {
        await moveV2ConversationToProject(conversationId, projectId, agentSlug);
      } catch (error) {
        rollback();
        throw error;
      }
      // Counts changed, and the destination view may not hold this row yet.
      void queryClient.invalidateQueries({ queryKey: V2_SESSIONS_KEY });
      invalidateProjects();
    },
    [queryClient, invalidateProjects],
  );

  const updateProject = useCallback(
    async (projectId: string, patch: ChatProjectInput): Promise<void> => {
      const rollback = patchProjectInCache(queryClient, projectId, patch);
      try {
        await updateV2ChatProject(projectId, patch);
      } catch (error) {
        rollback();
        throw error;
      }
      invalidateProjects();
    },
    [queryClient, invalidateProjects],
  );

  const renameProject = useCallback(
    async (projectId: string, name: string): Promise<void> => {
      await updateProject(projectId, { name });
    },
    [updateProject],
  );

  const deleteProject = useCallback(
    async (projectId: string): Promise<void> => {
      const rollback = removeProjectFromCache(queryClient, projectId);
      try {
        await deleteV2ChatProject(projectId);
      } catch (error) {
        rollback();
        throw error;
      }
      void queryClient.invalidateQueries({ queryKey: V2_SESSIONS_KEY });
      invalidateProjects();
    },
    [queryClient, invalidateProjects],
  );

  const createProject = useCallback(
    async (input: ChatProjectInput): Promise<ChatProject> => {
      // Not optimistic: the server mints the id and the sort position, and a
      // placeholder row would have neither.
      const created = await createV2ChatProject(input);
      invalidateProjects();
      return created;
    },
    [invalidateProjects],
  );

  const reorderProjects = useCallback(
    async (projectIds: string[]): Promise<void> => {
      const previous = queryClient.getQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY);
      const order = new Map(projectIds.map((id, index) => [id, index]));
      queryClient.setQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY, (projects): ChatProject[] =>
        [...(projects ?? [])].sort(
          (a, b) => (order.get(a.id) ?? a.sortOrder) - (order.get(b.id) ?? b.sortOrder),
        ),
      );
      try {
        await reorderV2ChatProjects(projectIds);
      } catch (error) {
        queryClient.setQueryData<ChatProject[]>(V2_CHAT_PROJECTS_KEY, previous);
        throw error;
      }
      invalidateProjects();
    },
    [queryClient, invalidateProjects],
  );

  return {
    moveChatToProject,
    updateProject,
    renameProject,
    deleteProject,
    createProject,
    reorderProjects,
  };
}
