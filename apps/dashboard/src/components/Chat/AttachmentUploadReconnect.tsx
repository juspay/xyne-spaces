import { useEffect, useRef } from 'react';
import { AttachmentUploadStatus } from '@xyne/shared';
import { useZeroOfflineState } from '@xyne/shared/hooks';
import { stateMachineActor } from '../../machines/stateMachine';
import { hasFileInMemory, useDraftAttachments } from '../../hooks/useDraft';

/**
 * Retries uploads that only failed because the connection was gone.
 *
 * Attaching a file while offline fails immediately and the row is marked FAILED. That is
 * correct — the bytes are not coming — but FAILED is permanent, and a composer holding only
 * a failed attachment keeps its send button disabled. Coming back online would otherwise
 * leave the user stuck with no obvious way forward but to remove the file and attach it
 * again, which is a poor answer when nothing is actually wrong with it.
 *
 * Mounted once at the app root rather than in the composer: the retry must cover every
 * channel the user has a draft in, not just the one on screen, and a per-composer effect
 * would fire several times at once (the panel renders in search and once per Streams
 * column).
 *
 * Renders nothing.
 */
export const AttachmentUploadReconnect = (): null => {
  const { isOffline } = useZeroOfflineState();
  const { retryAttachment } = useDraftAttachments();

  // Only a transition back from offline should trigger this. Without the latch, the effect
  // would also run on first mount while perfectly online and retry old failures that the
  // user had already decided to leave alone.
  const wasOffline = useRef(false);

  useEffect(() => {
    if (isOffline) {
      wasOffline.current = true;
      return;
    }
    if (!wasOffline.current) return;
    wasOffline.current = false;

    const drafts = stateMachineActor.getSnapshot().context.draftMessages;
    for (const draft of drafts) {
      for (const attachment of draft.attachments ?? []) {
        if (attachment.uploadStatus !== AttachmentUploadStatus.FAILED) continue;
        // Without the bytes, retryAttachment would open a file picker. On a reconnect the
        // user has not asked for anything, so those are left for them to retry by hand.
        if (!hasFileInMemory(attachment.id)) continue;
        void retryAttachment(attachment.id, draft.channelId, draft.conversationId);
      }
    }
  }, [isOffline, retryAttachment]);

  return null;
};

export default AttachmentUploadReconnect;
