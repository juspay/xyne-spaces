import { clawRequest } from './clawRequest';
import type { KbCollectionNode } from './clawKnowledgeBaseTypes';

/**
 * The user's accessible KB tree from spaces, used to populate the picker.
 *
 * NOTE: unlike every other claw endpoint, this response puts `collections` at
 * the top level (not under `data`) and carries a `noSpacesSession` flag — so it
 * is unwrapped by hand rather than through a generic `{ success, data }` read.
 */
export async function listAccessibleKnowledgeBase(): Promise<{
  collections: KbCollectionNode[];
  noSpacesSession: boolean;
}> {
  const data = await clawRequest<{
    success: boolean;
    collections: KbCollectionNode[];
    noSpacesSession?: boolean;
  }>('/api/v1/knowledge-base/tree?includeItems=1');
  return {
    collections: data.collections ?? [],
    noSpacesSession: data.noSpacesSession === true,
  };
}
