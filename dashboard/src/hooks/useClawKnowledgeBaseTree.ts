import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { listAccessibleKnowledgeBase } from '../services/claw/clawKnowledgeBaseService';
import type { KbCollectionNode } from '../services/claw/clawKnowledgeBaseTypes';

export interface ClawKnowledgeBaseTree {
  collections: KbCollectionNode[];
  noSpacesSession: boolean;
}

/**
 * The user's accessible spaces KB tree. Consumed inside KnowledgeBasePicker
 * (replacing its self-fetch effect) so toggling KB scope back and forth reuses
 * the cache instead of refetching.
 */
export const useClawKnowledgeBaseTree = (options?: {
  enabled?: boolean;
}): UseQueryResult<ClawKnowledgeBaseTree, Error> =>
  useQuery({
    queryKey: ['claw-kb-tree'],
    queryFn: listAccessibleKnowledgeBase,
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  });
