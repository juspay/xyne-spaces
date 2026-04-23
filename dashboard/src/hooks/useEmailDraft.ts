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
 *
 * `channelId` is required by the `emailDraft.upsert` mutator (email_drafts now
 * has a NOT NULL channelId column used by EmailDraftsACL). saveDraft is a
 * no-op when channelId is missing so zod validation doesn't silently reject
 * the mutation.
 */
export function useEmailDraftOperations(
  conversationId: string | null | undefined,
  channelId: string | null | undefined,
) {
  const zero = useZero();
  const [dbDrafts] = useCachedQuery(
    queries.getDraftForConversation({ conversationId: conversationId || '' }),
    { enabled: !!conversationId },
  );

  const draftId = dbDrafts?.[0]?.id;

  const deleteDraft = useCallback(() => {
    if (!conversationId) return;
    void zero.mutate(mutators.emailDraft.delete({ conversationId }));
  }, [conversationId, zero]);

  const saveDraft = useCallback(
    (content: string) => {
      if (!conversationId) return;
      // When the composer is cleared, remove the persisted draft so the
      // ticket-list "Draft" chip disappears and we don't keep stale content
      // around. Only fires a delete when a draft actually exists.
      if (!content.trim()) {
        if (draftId) deleteDraft();
        return;
      }
      if (!channelId) return;
      void zero.mutate(
        mutators.emailDraft.upsert({
          id: draftId ?? uuidv4(),
          conversationId,
          channelId,
          draftContent: content,
          updatedAt: Date.now(),
        }),
      );
    },
    [conversationId, channelId, draftId, zero, deleteDraft],
  );

  return { saveDraft, deleteDraft, draftId };
}
