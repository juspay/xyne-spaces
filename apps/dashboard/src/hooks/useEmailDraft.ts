import { useCallback, useMemo } from 'react';
import { AutoDraftStatus } from '@xyne/shared';
import { useZero } from './useZero';
import { queries } from '../zero/queries';
import { useCachedQuery } from './useCachedQuery';
import { mutators } from '../zero/mutators';
import { useAuthContextValues } from './useAuth';
import { parseStringList } from './useComposeDraft';
import { v4 as uuidv4 } from 'uuid';

export interface EmailDraftRecord {
  id: string;
  conversationId: string;
  channelId: string;
  userId?: string | null;
  draftContent: string;
  attachmentIds?: string[];
  toRecipients?: string[] | null | undefined;
  ccRecipients?: string[] | null | undefined;
  bccRecipients?: string[] | null | undefined;
  autoDraftStatus?: AutoDraftStatus | null;
  createdAt: number;
  updatedAt: number;
}

interface DraftRecipients {
  to: string[];
  cc: string[];
  bcc: string[];
}

/**
 * Zero rows carry the recipient columns as raw TEXT (JSON-stringified string[] —
 * the emailDraft mutators stringify on write), so parse them back at this read
 * boundary; consumers keep seeing string[] with the presence semantics preserved
 * (null/undefined = never persisted, [] = explicitly cleared).
 */
function parseDraftRecipients(row: EmailDraftRecord): EmailDraftRecord {
  return {
    ...row,
    toRecipients: parseStringList(row.toRecipients),
    ccRecipients: parseStringList(row.ccRecipients),
    bccRecipients: parseStringList(row.bccRecipients),
  };
}

/** Order-sensitive equality for the recipient lists (null/undefined treated as empty). */
function sameStringList(a: string[] | null | undefined, b: string[] | null | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
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
  const rows = (dbDrafts as unknown as EmailDraftRecord[] | undefined) ?? [];
  const row = rows[0];
  // Memoized on the row snapshot so consumers keep stable references between renders.
  return useMemo(() => (row ? parseDraftRecipients(row) : undefined), [row]);
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
  saveDraft: (
    content: string,
    attachmentIds?: string[],
    recipients?: DraftRecipients,
  ) => string | null;
  saveRecipients: (to: string[], cc: string[], bcc: string[]) => void;
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

  const ownRow =
    dbDrafts && userID
      ? (dbDrafts as unknown as EmailDraftRecord[]).find(d => d.userId === userID)
      : undefined;
  // Memoized on the row snapshot: the sameStringList guard below and EmailComposer's
  // hydration effect both depend on this object keeping a stable reference.
  const ownDraft = useMemo(() => (ownRow ? parseDraftRecipients(ownRow) : undefined), [ownRow]);
  const ownDraftId = ownDraft?.id;

  const deleteDraft = useCallback(() => {
    if (!conversationId) return;
    void zero.mutate(mutators.emailDraft.delete({ conversationId }));
  }, [conversationId, zero]);

  const saveDraft = useCallback(
    (content: string, attachmentIds?: string[], recipients?: DraftRecipients): string | null => {
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
          ...(recipients && {
            toRecipients: recipients.to,
            ccRecipients: recipients.cc,
            bccRecipients: recipients.bcc,
          }),
          updatedAt: Date.now(),
        }),
      );
      return nextDraftId;
    },
    [conversationId, channelId, ownDraftId, zero, deleteDraft],
  );

  // Persist recipients onto an EXISTING draft only. We never create a draft from
  // recipients alone, so opening a reply (which pre-fills recipients) doesn't spawn a
  // phantom draft. Recipients get captured once the user starts a real draft (body),
  // and edits after that are saved here. Merges server-side (won't clobber the body).
  //
  // The value-equality guard against the current draft is load-bearing: the composer's
  // recipients load/save effects otherwise ping-pong (load sets fresh array refs → save
  // effect re-fires → upsert bumps updatedAt → Zero re-emits a new draft → load re-runs),
  // an unbounded write loop. Skipping the write when nothing changed cuts it at the source.
  const saveRecipients = useCallback(
    (to: string[], cc: string[], bcc: string[]): void => {
      if (!conversationId || !channelId || !ownDraftId) return;
      if (
        sameStringList(to, ownDraft?.toRecipients) &&
        sameStringList(cc, ownDraft?.ccRecipients) &&
        sameStringList(bcc, ownDraft?.bccRecipients)
      ) {
        return;
      }
      void zero.mutate(
        mutators.emailDraft.upsert({
          id: ownDraftId,
          conversationId,
          channelId,
          toRecipients: to,
          ccRecipients: cc,
          bccRecipients: bcc,
          updatedAt: Date.now(),
        }),
      );
    },
    [
      conversationId,
      channelId,
      ownDraftId,
      ownDraft?.toRecipients,
      ownDraft?.ccRecipients,
      ownDraft?.bccRecipients,
      ownDraft?.updatedAt,
      zero,
    ],
  );

  return { saveDraft, saveRecipients, deleteDraft, draftId: ownDraftId ?? null, draft: ownDraft };
}
