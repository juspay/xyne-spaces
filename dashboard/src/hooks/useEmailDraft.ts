import { useCallback } from 'react';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { mutators } from '../zero/mutators';
import { v4 as uuidv4 } from 'uuid';

export interface EmailDraftRecord {
  id: string;
  conversationId: string;
  channelId: string;
  draftContent: string;
  attachmentIds?: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Returns the current draft for a conversation from Zero cache.
 */
export function useEmailDraft(
  conversationId: string | null | undefined,
): EmailDraftRecord | undefined {
  const [dbDrafts] = useCachedQuery(
    queries.getDraftForConversation({ conversationId: conversationId || '' }),
    { enabled: !!conversationId },
  );
  return (dbDrafts as unknown as EmailDraftRecord[] | undefined)?.[0];
}

/**
 * Provides save/delete for the email draft of a conversation.
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
  const draft = useEmailDraft(conversationId);

  const deleteDraft = useCallback(() => {
    if (!conversationId) return;
    void zero.mutate(mutators.emailDraft.delete({ conversationId }));
  }, [conversationId, zero]);

  const saveDraft = useCallback(
    (content: string, attachmentIds?: string[]): string | null => {
      if (!conversationId) return null;
      // When the composer is cleared (no body AND no attachments), remove the
      // persisted draft so the ticket-list "Draft" chip disappears and we don't
      // keep stale content around. Only fires a delete when a draft actually exists.
      if (!content.trim() && (!attachmentIds || attachmentIds.length === 0)) {
        if (draft?.id) deleteDraft();
        return null;
      }
      if (!channelId) return null;
      const nextDraftId = draft?.id ?? uuidv4();
      void zero.mutate(
        mutators.emailDraft.upsert({
          id: nextDraftId,
          conversationId,
          channelId,
          draftContent: content,
          ...(attachmentIds && attachmentIds.length > 0 && { attachmentIds }),
          updatedAt: Date.now(),
        }),
      );
      return nextDraftId;
    },
    [conversationId, channelId, draft?.id, zero, deleteDraft],
  );

  return { saveDraft, deleteDraft, draftId: draft?.id ?? null, draft };
}
