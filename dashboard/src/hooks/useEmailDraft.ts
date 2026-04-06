import { useCallback } from 'react';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { mutators } from '../zero/mutators';
import { v4 as uuidv4 } from 'uuid';

/**
 * Returns the current draft content for a conversation from Zero cache.
 * Zero's optimistic updates make this instant — no localStorage needed.
 */
export function useEmailDraft(conversationId: string | null | undefined): string | undefined {
  const [dbDrafts] = useCachedQuery(
    queries.getDraftForConversation({ conversationId: conversationId || '' }),
    { enabled: !!conversationId },
  );
  return dbDrafts?.[0]?.draftContent;
}

/**
 * Provides save/delete for the email draft of a conversation.
 * Upserts by conversationId (natural key) — no duplicate drafts on page refresh.
 * Call saveDraft on blur, not on every keystroke, to minimise DB writes.
 */
export function useEmailDraftOperations(conversationId: string | null | undefined) {
  const zero = useZero();
  const [dbDrafts] = useCachedQuery(
    queries.getDraftForConversation({ conversationId: conversationId || '' }),
    { enabled: !!conversationId },
  );

  const draftId = dbDrafts?.[0]?.id;

  const saveDraft = useCallback(
    (content: string) => {
      if (!conversationId || !content.trim()) return;
      void zero.mutate(
        mutators.emailDraft.upsert({
          id: draftId ?? uuidv4(),
          conversationId,
          draftContent: content,
          updatedAt: Date.now(),
        }),
      );
    },
    [conversationId, draftId, zero],
  );

  const deleteDraft = useCallback(() => {
    if (!conversationId) return;
    void zero.mutate(mutators.emailDraft.delete({ conversationId }));
  }, [conversationId, zero]);

  return { saveDraft, deleteDraft, draftId };
}
