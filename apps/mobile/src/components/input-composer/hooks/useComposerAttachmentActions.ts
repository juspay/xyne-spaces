import { useCallback, useRef } from 'react';
import { Alert } from 'react-native';

import { useDraftAttachments } from '@/src/hooks/useDraftAttachments';

import {
  useChatInputActions,
  useChatInputComposerState,
  useChatInputConversation,
} from '../input-composer-context';
import type { ComposerAttachment } from '../input-composer.types';
import { ingestComposerAttachments } from '../utils/pasteComposerAttachments';
import { useLatestRef } from '../utils/use-latest-ref';

export type ComposerAttachmentActions = {
  /** Drops the chip at once and deletes the draft upload; puts it back if the delete fails. */
  remove: (attachmentId: string) => void;
  /** Uploads a failed chip again through the same draft upload a new pick goes through. */
  retry: (attachmentId: string) => void;
};

/**
 * What a composer's attachment chips can do, for every surface that draws them.
 * The actions read the chips through a ref, so they stay the same functions
 * as chips come and go and memoised chips need not re-render.
 */
export const useComposerAttachmentActions = (): ComposerAttachmentActions => {
  const { conversationId, threadId } = useChatInputConversation();
  const { attachments } = useChatInputComposerState();
  const attachmentsRef = useLatestRef(attachments);
  const { setAttachments, beginAttachmentMutation, endAttachmentMutation } = useChatInputActions();
  const { addAttachments: uploadDraftAttachments, removeAttachment: deleteDraftAttachment } =
    useDraftAttachments();

  const remove = useCallback(
    (attachmentId: string): void => {
      const removedAttachment = attachmentsRef.current.find(item => item.attachmentId === attachmentId);
      if (!removedAttachment) return;

      setAttachments(prev => prev.filter(item => item.attachmentId !== attachmentId));
      beginAttachmentMutation();

      void (async (): Promise<void> => {
        try {
          const isDeleted = await deleteDraftAttachment(attachmentId);
          if (!isDeleted) {
            setAttachments(prev =>
              prev.some(item => item.attachmentId === removedAttachment.attachmentId)
                ? prev
                : [...prev, removedAttachment],
            );
            Alert.alert('Failed to remove attachment', 'Please try removing the attachment again.');
          }
        } finally {
          endAttachmentMutation();
        }
      })();
    },
    [
      attachmentsRef,
      beginAttachmentMutation,
      deleteDraftAttachment,
      endAttachmentMutation,
      setAttachments,
    ],
  );

  // A second tap lands before the chip re-renders as uploading, so the id is held here meanwhile.
  const retryingRef = useRef(new Set<string>());

  const retry = useCallback(
    (attachmentId: string): void => {
      const current = attachmentsRef.current;
      const failed = current.find(item => item.attachmentId === attachmentId);
      if (failed?.status !== 'failed' || retryingRef.current.has(attachmentId)) return;
      retryingRef.current.add(attachmentId);
      // A failed upload already dropped its draft row, so the same chip goes up again as new.
      const { error: _error, ...rest } = failed;
      const again: ComposerAttachment = { ...rest, status: 'local' };

      void ingestComposerAttachments({
        newAttachments: [again],
        existingAttachments: current.filter(item => item.attachmentId !== attachmentId),
        setAttachments,
        uploadDraftAttachments,
        conversationId,
        threadId: threadId ?? null,
      })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Unable to upload attachment';
          Alert.alert('Attachment unavailable', message);
        })
        .finally(() => retryingRef.current.delete(attachmentId));
    },
    [attachmentsRef, conversationId, setAttachments, threadId, uploadDraftAttachments],
  );

  return { remove, retry };
};
