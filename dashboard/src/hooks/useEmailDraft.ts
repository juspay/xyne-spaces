import { useCallback } from 'react';
import { AutoDraftStatus } from '@xyne/shared';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { mutators } from '../zero/mutators';
import { useAuthContextValues } from './useAuth';
import { v4 as uuidv4 } from 'uuid';

export interface EmailDraftRecord {
  id: string;
  conversationId: string;
  channelId: string;
  userId?: string | null;
  draftContent: string;
  attachmentIds?: string[];
  autoDraftStatus?: AutoDraftStatus | null;
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
 * `channelId` is required by the `emailDraft.upsert` mutator (email_drafts
 * has a NOT NULL channelId column used by EmailDraftsACL). saveDraft is a
 * no-op when channelId is missing so zod validation doesn't silently reject
 * the mutation.
 */
export function useEmailDraftOperations(
  conversationId: string | null | undefined,
  channelId: string | null | undefined,
): {
  saveDraft: (content: string, attachmentIds?: string[]) => string | null;
  deleteDraft: () => void;
  draftId: string | null;
  draft: EmailDraftRecord | undefined;
} {
  const zero = useZero();
  const { userID } = useAuthContextValues();
  const [dbDrafts] = useCachedQuery(
    queries.getDraftForConversation({ conversationId: conversationId || '' }),
    { enabled: !!conversationId },
  );

  const ownDraft =
    dbDrafts && userID
      ? (dbDrafts as unknown as EmailDraftRecord[]).find(d => d.userId === userID)
      : undefined;
  const ownDraftId = ownDraft?.id;

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
        if (ownDraftId) deleteDraft();
        return null;
      }
      if (!channelId) return null;
      const nextDraftId = ownDraftId ?? uuidv4();
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
    [conversationId, channelId, ownDraftId, zero, deleteDraft],
  );

  return { saveDraft, deleteDraft, draftId: ownDraftId ?? null, draft: ownDraft };
}
