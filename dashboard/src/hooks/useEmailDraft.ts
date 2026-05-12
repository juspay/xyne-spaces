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

export function useEmailDrafts(conversationId: string | null | undefined): EmailDraftRecord[] {
  const [dbDrafts] = useCachedQuery(
    queries.getDraftForConversation({ conversationId: conversationId || '' }),
    { enabled: !!conversationId },
  );
  return (dbDrafts as unknown as EmailDraftRecord[] | undefined) ?? [];
}

/**
 * Returns a specific saved draft for a conversation.
 */
export function useEmailDraft(
  conversationId: string | null | undefined,
  draftId: string | null | undefined,
): EmailDraftRecord | undefined {
  const drafts = useEmailDrafts(conversationId);
  if (!draftId) return undefined;
  return drafts.find(draft => draft.id === draftId);
}

/**
 * Provides save/delete for a single email draft within a conversation.
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
  draftId: string | null | undefined,
) {
  const zero = useZero();
  const draft = useEmailDraft(conversationId, draftId);

  const deleteDraft = useCallback(
    (targetDraftId?: string | null) => {
      const nextDraftId = targetDraftId ?? draft?.id ?? draftId;
      if (!nextDraftId) return;
      void zero.mutate(mutators.emailDraft.delete({ id: nextDraftId }));
    },
    [draft?.id, draftId, zero],
  );

  const saveDraft = useCallback(
    (content: string, attachmentIds?: string[]): string | null => {
      if (!conversationId) return null;
      // When the composer is cleared (no body AND no attachments), remove the
      // persisted draft so the ticket-list "Draft" chip disappears and we don't
      // keep stale content around. Only fires a delete when a draft actually exists.
      if (!content.trim() && (!attachmentIds || attachmentIds.length === 0)) {
        if (draft?.id ?? draftId) {
          deleteDraft(draft?.id ?? draftId);
        }
        return null;
      }
      if (!channelId) return null;
      const nextDraftId = draft?.id ?? draftId ?? uuidv4();
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
    [conversationId, channelId, draft?.id, draftId, zero, deleteDraft],
  );

  return { saveDraft, deleteDraft, draftId: draft?.id ?? draftId ?? null, draft };
}
