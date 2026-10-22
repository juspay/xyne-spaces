import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  deleteDesignSystem,
  fetchConversationDesignSystem,
  fetchDesignSystems,
  pinConversationDesignSystem,
  setAgentDesignSystem,
  unpinConversationDesignSystem,
  updateDesignSystem,
  type DesignSystemRecord,
} from '../services/XyneAI/XyneAIDesignSystemsService';

const DESIGN_SYSTEMS_KEY = ['xyne-ai-design-systems'] as const;

export const conversationDesignSystemKey = (conversationId: string): readonly string[] => [
  'xyne-ai-conversation-design-system',
  conversationId,
];

const NO_SYSTEMS: DesignSystemRecord[] = [];

export function useDesignSystems({ enabled = true }: { enabled?: boolean } = {}) {
  const result = useQuery({
    queryKey: DESIGN_SYSTEMS_KEY,
    queryFn: fetchDesignSystems,
    staleTime: 30_000,
    enabled,
  });
  return {
    systems: result.data ?? NO_SYSTEMS,
    isLoading: result.isLoading,
    isError: result.isError,
    refetch: result.refetch,
  };
}

export function useDesignSystemActions() {
  const queryClient = useQueryClient();

  const invalidate = useCallback((): void => {
    void queryClient.invalidateQueries({ queryKey: DESIGN_SYSTEMS_KEY });
  }, [queryClient]);

  const remove = useMutation({
    mutationFn: (id: string) => deleteDesignSystem(id),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { name?: string; designMd?: string } }) =>
      updateDesignSystem(id, patch),
    onSuccess: invalidate,
  });

  const setDefault = useMutation({
    mutationFn: ({ agentSlug, designSystemId }: { agentSlug: string; designSystemId: string }) =>
      setAgentDesignSystem(agentSlug, designSystemId),
  });

  return { remove, update, setDefault };
}

export function useConversationDesignSystem(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const key = conversationDesignSystemKey(conversationId ?? '');

  const result = useQuery({
    queryKey: key,
    queryFn: () => fetchConversationDesignSystem(conversationId as string),
    enabled: Boolean(conversationId),
    staleTime: 30_000,
  });

  const pin = useCallback(
    async (system: DesignSystemRecord): Promise<void> => {
      if (!conversationId) return;
      const previous = queryClient.getQueryData<DesignSystemRecord | null>(key);
      queryClient.setQueryData<DesignSystemRecord | null>(key, system);
      try {
        await pinConversationDesignSystem(conversationId, system.id);
      } catch (error) {
        queryClient.setQueryData(key, previous ?? null);
        throw error;
      }
    },
    [conversationId, queryClient, key],
  );

  const unpin = useCallback(async (): Promise<void> => {
    if (!conversationId) return;
    const previous = queryClient.getQueryData<DesignSystemRecord | null>(key);
    queryClient.setQueryData<DesignSystemRecord | null>(key, null);
    try {
      await unpinConversationDesignSystem(conversationId);
    } catch (error) {
      queryClient.setQueryData(key, previous ?? null);
      throw error;
    }
  }, [conversationId, queryClient, key]);

  return {
    pinned: result.data ?? null,
    isLoading: result.isLoading,
    pin,
    unpin,
  };
}
