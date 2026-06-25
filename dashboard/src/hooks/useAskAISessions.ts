/**
 * Hook for managing Ask AI sessions via backend API.
 *
 * Replaces IndexedDB as the source of truth for conversation history.
 * Sessions and messages are fetched from the backend, enabling cross-device persistence.
 *
 * Raw API calls live in XyneAISessionsService; this file only exposes React Query hooks.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ConversationHistory as ConversationHistoryType } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';
import {
  fetchSessions,
  fetchSessionDetail,
  toggleStarApi,
  renameSessionApi,
  deleteSessionApi,
  updateSessionMetadataApi,
  sessionDetailToConversationHistory,
  SessionMetadataPayload,
} from '../services/XyneAI/XyneAISessionsService';

// ============================================================================
// Query Keys
// ============================================================================

const SESSIONS_KEY = ['xyne-ai-sessions'] as const;
// ============================================================================
// Hooks
// ============================================================================

/**
 * List all sessions for the current user (lightweight, no messages).
 */
export function useSessionsList() {
  return useQuery({
    queryKey: SESSIONS_KEY,
    queryFn: fetchSessions,
    staleTime: 30_000,
  });
}

/**
 * Mutation hooks for session management (star, rename, delete, metadata).
 */
export function useSessionMutations() {
  const queryClient = useQueryClient();

  const toggleStar = useMutation({
    mutationFn: (sessionId: string) => toggleStarApi(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });

  const rename = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      renameSessionApi(sessionId, title),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });

  const deleteSession = useMutation({
    mutationFn: (sessionId: string) => deleteSessionApi(sessionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
    },
  });

  const updateMetadata = useMutation({
    mutationFn: ({
      sessionId,
      metadata,
    }: {
      sessionId: string;
      metadata: SessionMetadataPayload;
    }) => updateSessionMetadataApi(sessionId, metadata),
  });

  return { toggleStar, rename, deleteSession, updateMetadata };
}

// ============================================================================
// Imperative helpers (used outside React render — e.g. event handlers, effects)
// ============================================================================

/**
 * Load a full session with messages imperatively (not as a reactive hook).
 * Used when a conversation is clicked in history.
 */
export async function loadSessionDetail(
  sessionId: string,
): Promise<ConversationHistoryType | null> {
  try {
    const detail = await fetchSessionDetail(sessionId);
    return sessionDetailToConversationHistory(detail);
  } catch (error) {
    console.error('[useAskAISessions] Failed to load session detail:', error);
    return null;
  }
}

/**
 * Persist session metadata (branchSelections, feedbackMap, title) to the backend.
 * Called from effects — fire-and-forget, errors are logged but not surfaced.
 */
export async function saveSessionMetadata(
  sessionId: string,
  metadata: SessionMetadataPayload,
): Promise<void> {
  try {
    await updateSessionMetadataApi(sessionId, metadata);
  } catch (error) {
    console.error('[useAskAISessions] Failed to save session metadata:', error);
  }
}
