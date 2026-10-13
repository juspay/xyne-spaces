import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { xyneAIStreamManager } from '../../../services/XyneAI/XyneAIStreamManager';
import {
  conversationArtifactsQueryKey,
  listConversationArtifacts,
  patchConversationArtifact,
  type ConversationArtifact,
  type ConversationArtifactPatch,
} from '../../../services/XyneAI/XyneAIArtifactsService';
import { subscribeToArtifactChanges } from './pagePanelCalls';

function useConversationStreaming(conversationId: string | null): boolean {
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    if (!conversationId) {
      setStreaming(false);
      return;
    }
    const read = (): void => {
      setStreaming(xyneAIStreamManager.getStreamingSessionIds().includes(conversationId));
    };
    read();
    const unsubscribe = xyneAIStreamManager.subscribe(read);
    return unsubscribe;
  }, [conversationId]);

  return streaming;
}

/** Conversations whose list is to be fetched afresh this tick. */
const refreshing = new Set<string>();

/**
 * Fetches a conversation's artifacts afresh, once for every screen part showing
 * them that heard the same news in the same tick. A fetch already running is
 * replaced, not joined: it may have started before the change it is told of.
 */
function refreshSoon(queryClient: QueryClient, conversationId: string): void {
  if (refreshing.has(conversationId)) return;
  refreshing.add(conversationId);
  queueMicrotask(() => {
    refreshing.delete(conversationId);
    void queryClient.invalidateQueries({
      queryKey: conversationArtifactsQueryKey(conversationId),
    });
  });
}

export interface ConversationArtifactsResult {
  artifacts: ConversationArtifact[];
  isLoading: boolean;
  isError: boolean;
  patch: (artifactId: string, patch: ConversationArtifactPatch) => void;
}

export function useConversationArtifacts(
  conversationId: string | null,
): ConversationArtifactsResult {
  const queryClient = useQueryClient();
  const streaming = useConversationStreaming(conversationId);

  const query = useQuery({
    queryKey: conversationArtifactsQueryKey(conversationId ?? ''),
    queryFn: () => listConversationArtifacts(conversationId as string),
    enabled: Boolean(conversationId),
    staleTime: 15_000,
  });

  // Fetched afresh when the server says the conversation's artifacts changed, and
  // once more when a run ends.
  useEffect(() => {
    if (!conversationId) return undefined;
    return subscribeToArtifactChanges(changed => {
      if (changed !== null && changed !== conversationId) return;
      refreshSoon(queryClient, conversationId);
    });
  }, [conversationId, queryClient]);

  const wasStreaming = useRef(streaming);
  useEffect(() => {
    const finished = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    if (!finished || !conversationId) return;
    void queryClient.invalidateQueries({
      queryKey: conversationArtifactsQueryKey(conversationId),
    });
  }, [streaming, conversationId, queryClient]);

  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ConversationArtifactPatch }) =>
      patchConversationArtifact(id, patch),
    onMutate: ({ id, patch }: { id: string; patch: ConversationArtifactPatch }) => {
      if (!conversationId) return { previous: undefined };
      const key = conversationArtifactsQueryKey(conversationId);
      const previous = queryClient.getQueryData<ConversationArtifact[]>(key);
      queryClient.setQueryData<ConversationArtifact[]>(key, prev =>
        prev ? prev.map(a => (a.id === id ? { ...a, ...patch } : a)) : prev,
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (conversationId && context?.previous) {
        queryClient.setQueryData<ConversationArtifact[]>(
          conversationArtifactsQueryKey(conversationId),
          context.previous,
        );
      }
      toast.error('Could not update this artifact.');
    },
    onSuccess: updated => {
      if (!conversationId || !updated) return;
      queryClient.setQueryData<ConversationArtifact[]>(
        conversationArtifactsQueryKey(conversationId),
        prev => (prev ? prev.map(a => (a.id === updated.id ? updated : a)) : prev),
      );
    },
  });

  const { mutate } = mutation;

  return {
    artifacts: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    patch: (id, patch) => mutate({ id, patch }),
  };
}
