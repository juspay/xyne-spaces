import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { xyneAIStreamManager } from '../../../services/XyneAI/XyneAIStreamManager';
import { usePollWhenShown } from '../../../hooks/usePageCoverage';
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

/** Conversations whose list is to be fetched afresh this tick, and whether a part on screen asked. */
const refreshing = new Map<string, boolean>();

/**
 * Fetches a conversation's artifacts afresh, once for every screen part showing
 * them that heard the same news in the same tick. A fetch already running is
 * replaced, not joined: it may have started before the change it is told of.
 * With every part asking under full-page search (`shown` false), the list is only
 * marked stale: it is fetched on the return to its page.
 */
function refreshSoon(queryClient: QueryClient, conversationId: string, shown: boolean): void {
  const asked = refreshing.get(conversationId);
  refreshing.set(conversationId, (asked ?? false) || shown);
  if (asked !== undefined) return;
  queueMicrotask(() => {
    const fetchNow = refreshing.get(conversationId) ?? false;
    refreshing.delete(conversationId);
    void queryClient.invalidateQueries({
      queryKey: conversationArtifactsQueryKey(conversationId),
      refetchType: fetchNow ? 'active' : 'none',
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
  const queryKey = conversationArtifactsQueryKey(conversationId ?? '');
  // Under full-page search the list is out of sight: what would fetch it afresh there only marks it
  // stale, and it is fetched on the return.
  const shown = usePollWhenShown(queryKey);

  const query = useQuery({
    queryKey,
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
      refreshSoon(queryClient, conversationId, shown());
    });
  }, [conversationId, queryClient, shown]);

  const wasStreaming = useRef(streaming);
  useEffect(() => {
    const finished = wasStreaming.current && !streaming;
    wasStreaming.current = streaming;
    if (!finished || !conversationId) return;
    void queryClient.invalidateQueries({
      queryKey: conversationArtifactsQueryKey(conversationId),
      refetchType: shown() ? 'active' : 'none',
    });
  }, [streaming, conversationId, queryClient, shown]);

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
